/*
  # Scalenie limitów kierownika z limitami działu

  ## Problem
  Funkcja check_department_limits() sprawdzała tylko limity działu (departments.max_invoice_amount,
  departments.max_monthly_amount), ignorując limity osobiste kierownika (manager_limits).

  ## Rozwiązanie
  Usunięcie starej sygnatury i stworzenie nowej wersji check_department_limits() tak by:
  - Pobierała limity działu z tabeli departments
  - Pobierała limity kierownika z tabeli manager_limits (dla kierownika faktury)
  - Używała bardziej restrykcyjnego limitu (MIN) dla każdego rodzaju limitu
  - Logika: limit_kierownika > limit_działu, czyli limit_działu jest sufitem

  ## Zmiany
  - Usunięto starą sygnaturę check_department_limits (4 parametry)
  - Nowa wersja: dodano opcjonalny parametr p_manager_id (uuid)
  - Efektywny limit = MIN(manager_limit, dept_limit) gdzie oba NOT NULL
  - Zachowana wsteczna kompatybilność przez domyślny NULL dla p_manager_id
  - Zaktualizowano wywołanie w handle_invoice_approval - przekazuje current_approver_id jako manager
*/

-- Usuń starą sygnaturę
DROP FUNCTION IF EXISTS check_department_limits(uuid, numeric, timestamptz, uuid);

-- Utwórz nową wersję z opcjonalnym p_manager_id
CREATE OR REPLACE FUNCTION check_department_limits(
    p_department_id uuid,
    p_invoice_amount numeric,
    p_invoice_date timestamptz,
    p_exclude_invoice_id uuid DEFAULT NULL,
    p_manager_id uuid DEFAULT NULL
) RETURNS jsonb AS $$
DECLARE
    v_dept_max_invoice_amount numeric;
    v_dept_max_monthly_amount numeric;
    v_mgr_single_limit numeric;
    v_mgr_monthly_limit numeric;
    v_effective_single_limit numeric;
    v_effective_monthly_limit numeric;
    v_current_month_total numeric;
BEGIN
    -- Pobierz limity działu
    SELECT 
        max_invoice_amount,
        max_monthly_amount
    INTO 
        v_dept_max_invoice_amount,
        v_dept_max_monthly_amount
    FROM departments
    WHERE id = p_department_id;

    -- Pobierz limity osobiste kierownika (jeśli podano)
    IF p_manager_id IS NOT NULL THEN
        SELECT
            NULLIF(single_invoice_limit, 0),
            NULLIF(monthly_limit, 0)
        INTO
            v_mgr_single_limit,
            v_mgr_monthly_limit
        FROM manager_limits
        WHERE manager_id = p_manager_id;
    END IF;

    -- Oblicz efektywne limity: oba ustawione -> min; tylko jeden -> ten jeden
    IF v_dept_max_invoice_amount IS NOT NULL AND v_mgr_single_limit IS NOT NULL THEN
        v_effective_single_limit := LEAST(v_dept_max_invoice_amount, v_mgr_single_limit);
    ELSIF v_dept_max_invoice_amount IS NOT NULL THEN
        v_effective_single_limit := v_dept_max_invoice_amount;
    ELSIF v_mgr_single_limit IS NOT NULL THEN
        v_effective_single_limit := v_mgr_single_limit;
    ELSE
        v_effective_single_limit := NULL;
    END IF;

    IF v_dept_max_monthly_amount IS NOT NULL AND v_mgr_monthly_limit IS NOT NULL THEN
        v_effective_monthly_limit := LEAST(v_dept_max_monthly_amount, v_mgr_monthly_limit);
    ELSIF v_dept_max_monthly_amount IS NOT NULL THEN
        v_effective_monthly_limit := v_dept_max_monthly_amount;
    ELSIF v_mgr_monthly_limit IS NOT NULL THEN
        v_effective_monthly_limit := v_mgr_monthly_limit;
    ELSE
        v_effective_monthly_limit := NULL;
    END IF;

    -- Sprawdź limit na pojedynczą fakturę
    IF v_effective_single_limit IS NOT NULL AND p_invoice_amount > v_effective_single_limit THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'single_invoice_limit',
            'limit_value', v_effective_single_limit,
            'invoice_value', p_invoice_amount,
            'message', format('Faktura (%s PLN) przekracza limit (%s PLN)',
                            ROUND(p_invoice_amount, 2), ROUND(v_effective_single_limit, 2))
        );
    END IF;

    -- Sprawdź limit miesięczny
    IF v_effective_monthly_limit IS NOT NULL THEN
        SELECT COALESCE(SUM(COALESCE(pln_gross_amount, gross_amount)), 0)
        INTO v_current_month_total
        FROM invoices
        WHERE department_id = p_department_id
        AND status IN ('accepted', 'paid')
        AND DATE_TRUNC('month', COALESCE(issue_date, created_at)) = DATE_TRUNC('month', p_invoice_date)
        AND (p_exclude_invoice_id IS NULL OR id != p_exclude_invoice_id);

        IF (v_current_month_total + p_invoice_amount) > v_effective_monthly_limit THEN
            RETURN jsonb_build_object(
                'within_limits', false,
                'reason', 'monthly_limit',
                'limit_value', v_effective_monthly_limit,
                'current_total', v_current_month_total,
                'invoice_value', p_invoice_amount,
                'new_total', v_current_month_total + p_invoice_amount,
                'message', format('Suma miesięczna (%s PLN + %s PLN = %s PLN) przekroczy limit (%s PLN)',
                                ROUND(v_current_month_total, 2),
                                ROUND(p_invoice_amount, 2),
                                ROUND(v_current_month_total + p_invoice_amount, 2),
                                ROUND(v_effective_monthly_limit, 2))
            );
        END IF;
    END IF;

    RETURN jsonb_build_object(
        'within_limits', true,
        'message', 'Faktura mieści się w limitach'
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_department_limits IS
'Sprawdza czy faktura mieści się w limitach kierownika i/lub działu.
Efektywny limit = MIN(limit_kierownika, limit_działu) - bardziej restrykcyjny wygrywa.
Parametr p_manager_id jest opcjonalny - jeśli podany, limity kierownika są brane pod uwagę.';

-- Zaktualizuj wywołanie w handle_invoice_approval by przekazywało ID kierownika
CREATE OR REPLACE FUNCTION handle_invoice_approval()
RETURNS trigger AS $$
DECLARE
    v_is_admin boolean;
    v_user_role text;
    v_approver_role text;
    v_approver_dept_id uuid;
    v_limits_check jsonb;
    v_director_id uuid;
    v_dept_name text;
    v_ceo_id uuid;
    v_invoice_amount numeric;
    v_manager_id uuid;
BEGIN
    SELECT is_admin, role 
    INTO v_is_admin, v_user_role
    FROM profiles
    WHERE id = auth.uid();
    
    IF v_is_admin = true OR v_user_role = 'CEO' THEN
        RETURN NEW;
    END IF;
    
    -- ==========================================
    -- OBSŁUGA: Dyrektor zmienia draft → waiting
    -- ==========================================
    IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN
        v_director_id := NEW.uploaded_by;
        
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = v_director_id;
        
        IF v_approver_role = 'Dyrektor' THEN
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            v_limits_check := check_director_limits(
                v_director_id,
                v_invoice_amount,
                COALESCE(NEW.issue_date, NEW.created_at::date),
                NEW.id
            );
            
            IF (v_limits_check->>'within_limits')::boolean = true THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();
                
                INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                VALUES (
                    NEW.id, v_director_id, 'approved_by_director_within_limits',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                    format('Faktura zatwierdzona przez Dyrektora w ramach limitów (%s PLN)', v_invoice_amount::text)
                );
                
                RETURN NEW;
            END IF;
            
            SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;
            
            IF v_ceo_id IS NOT NULL THEN
                NEW.current_approver_id := v_ceo_id;
                
                INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                VALUES (
                    NEW.id, v_director_id, 'forwarded_to_ceo',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id, 'limits_check', v_limits_check),
                    format('Faktura przekazana do CEO - przekroczono limity dyrektora (%s PLN)', v_invoice_amount::text)
                );
            ELSE
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();
                
                INSERT INTO audit_logs (invoice_id, user_id, action, description)
                VALUES (
                    NEW.id, v_director_id, 'approved_by_director_no_ceo',
                    format('Faktura zaakceptowana przez Dyrektora (brak CEO w systemie) - %s PLN', v_invoice_amount::text)
                );
            END IF;
        END IF;
    END IF;
    
    -- ==========================================
    -- OBSŁUGA: Akceptacja waiting → accepted
    -- ==========================================
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        v_manager_id := OLD.current_approver_id;
        
        SELECT role
        INTO v_approver_role
        FROM profiles
        WHERE id = v_manager_id;

        -- ==========================================
        -- Kierownik akceptuje fakturę
        -- ==========================================
        IF v_approver_role = 'Kierownik' THEN
            NEW.approved_by_manager_at := now();
            
            -- Sprawdź limity działu ORAZ limity osobiste kierownika
            v_limits_check := check_department_limits(
                NEW.department_id,
                COALESCE(NEW.pln_gross_amount, NEW.gross_amount),
                COALESCE(NEW.issue_date, NEW.created_at),
                NEW.id,
                v_manager_id  -- przekaż ID kierownika by uwzględnić jego osobiste limity
            );
            
            IF (v_limits_check->>'within_limits')::boolean = false THEN
                SELECT director_id, name
                INTO v_director_id, v_dept_name
                FROM departments
                WHERE id = NEW.department_id;
                
                IF v_director_id IS NULL THEN
                    SELECT p.id INTO v_director_id
                    FROM profiles p
                    WHERE p.department_id = NEW.department_id AND p.role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                IF v_director_id IS NOT NULL THEN
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_director_id;
                    
                    INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
                    VALUES (
                        NEW.id, auth.uid(), 'forwarded_to_director',
                        jsonb_build_object('status', 'waiting', 'current_approver_id', OLD.current_approver_id),
                        jsonb_build_object('status', 'waiting', 'current_approver_id', v_director_id,
                            'reason', v_limits_check->>'reason',
                            'message', v_limits_check->>'message'),
                        format('Faktura przekazana do Dyrektora - %s', v_limits_check->>'message')
                    );
                ELSE
                    NEW.current_approver_id := NULL;
                    
                    INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                    VALUES (
                        NEW.id, auth.uid(), 'accepted_without_director',
                        jsonb_build_object('reason', v_limits_check->>'reason', 'message', v_limits_check->>'message'),
                        format('Faktura zaakceptowana przez Kierownika mimo przekroczenia limitów (brak Dyrektora) - %s', v_limits_check->>'message')
                    );
                END IF;
            ELSE
                NEW.current_approver_id := NULL;
                
                INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
                VALUES (
                    NEW.id, auth.uid(), 'auto_accepted_within_limits',
                    jsonb_build_object('status', 'accepted', 'message', v_limits_check->>'message'),
                    'Faktura automatycznie zaakceptowana - mieści się w limitach'
                );
            END IF;
        
        -- ==========================================
        -- Dyrektor akceptuje fakturę (z poziomu waiting)
        -- ==========================================
        ELSIF v_approver_role = 'Dyrektor' THEN
            NEW.approved_by_director_at := now();
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (NEW.id, v_manager_id, 'approved_by_director', 'Faktura zaakceptowana przez Dyrektora');
        
        -- ==========================================
        -- CEO akceptuje
        -- ==========================================
        ELSIF v_approver_role = 'CEO' THEN
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (NEW.id, v_manager_id, 'approved_by_ceo', 'Faktura zaakceptowana przez CEO');
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury:
- Dyrektor: draft → waiting → sprawdza limity → auto-accept lub do CEO
- Kierownik: waiting → accepted → sprawdza limity działu I kierownika (MIN z obu) → auto-accept lub do Dyrektora
- Dyrektor: waiting → accepted → finalizuje akceptację
- CEO: waiting → accepted → finalizuje akceptację
- Admini i CEO są całkowicie pomijani';
