/*
  # Naprawa Sprawdzania Limitów Dyrektora przy Akceptacji

  ## Problem
  - Gdy Dyrektor zmienia status faktury z 'draft' na 'waiting', system automatycznie przekazuje do CEO
  - Brakuje sprawdzenia limitów dyrektora (single_invoice_limit i monthly_invoice_limit)
  - Faktury powinny być automatycznie akceptowane jeśli mieszczą się w limitach

  ## Rozwiązanie
  1. Dodaj sprawdzenie limitów dyrektora przed przekazaniem do CEO
  2. Jeśli faktura mieści się w limitach → status 'accepted', current_approver_id = NULL
  3. Jeśli przekracza limity → przekaż do CEO (jeśli istnieje)
  
  ## Przypadki
  - Faktura w limitach dyrektora → automatyczna akceptacja (status = 'accepted')
  - Faktura przekracza limity → przekazanie do CEO (status = 'waiting')
  - Brak limitów u dyrektora → przekazanie do CEO
*/

-- Funkcja do sprawdzania limitów dyrektora
CREATE OR REPLACE FUNCTION check_director_limits(
    p_director_id uuid,
    p_invoice_amount numeric,
    p_invoice_date date,
    p_invoice_id uuid DEFAULT NULL
)
RETURNS jsonb AS $$
DECLARE
    v_single_limit numeric;
    v_monthly_limit numeric;
    v_monthly_total numeric;
    v_result jsonb;
BEGIN
    -- Pobierz limity dyrektora
    SELECT 
        single_invoice_limit,
        monthly_invoice_limit
    INTO v_single_limit, v_monthly_limit
    FROM profiles
    WHERE id = p_director_id;
    
    -- Jeśli dyrektor nie ma ustawionych limitów, nie może automatycznie akceptować
    IF v_single_limit IS NULL OR v_monthly_limit IS NULL THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'no_limits_set',
            'message', 'Dyrektor nie ma ustawionych limitów - wymaga akceptacji CEO'
        );
    END IF;
    
    -- Sprawdź limit pojedynczej faktury
    IF p_invoice_amount > v_single_limit THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'single_invoice_limit_exceeded',
            'message', format('Przekroczono limit pojedynczej faktury (%.2f PLN > %.2f PLN)', 
                            p_invoice_amount, v_single_limit),
            'invoice_amount', p_invoice_amount,
            'single_limit', v_single_limit
        );
    END IF;
    
    -- Oblicz sumę zatwierdzonych faktur w tym miesiącu
    SELECT COALESCE(SUM(pln_gross_amount), 0)
    INTO v_monthly_total
    FROM invoices
    WHERE uploaded_by = p_director_id
    AND status = 'accepted'
    AND DATE_TRUNC('month', COALESCE(issue_date, created_at)) = DATE_TRUNC('month', p_invoice_date)
    AND (p_invoice_id IS NULL OR id != p_invoice_id);
    
    -- Sprawdź limit miesięczny
    IF (v_monthly_total + p_invoice_amount) > v_monthly_limit THEN
        RETURN jsonb_build_object(
            'within_limits', false,
            'reason', 'monthly_limit_exceeded',
            'message', format('Przekroczono limit miesięczny (%.2f PLN + %.2f PLN > %.2f PLN)', 
                            v_monthly_total, p_invoice_amount, v_monthly_limit),
            'monthly_total', v_monthly_total,
            'invoice_amount', p_invoice_amount,
            'monthly_limit', v_monthly_limit
        );
    END IF;
    
    -- Wszystko OK - faktura mieści się w limitach
    RETURN jsonb_build_object(
        'within_limits', true,
        'message', format('Faktura mieści się w limitach dyrektora (%.2f PLN, suma miesięczna: %.2f PLN)', 
                        p_invoice_amount, v_monthly_total + p_invoice_amount),
        'monthly_total', v_monthly_total,
        'invoice_amount', p_invoice_amount,
        'single_limit', v_single_limit,
        'monthly_limit', v_monthly_limit
    );
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Zaktualizuj funkcję handle_invoice_approval z sprawdzaniem limitów dyrektora
CREATE OR REPLACE FUNCTION handle_invoice_approval()
RETURNS trigger AS $$
DECLARE
    v_approver_role text;
    v_approver_dept_id uuid;
    v_limits_check jsonb;
    v_director_id uuid;
    v_dept_name text;
    v_ceo_id uuid;
    v_parent_director_id uuid;
    v_parent_dept_id uuid;
    v_invoice_amount numeric;
BEGIN
    -- Obsługa draft → waiting przez Dyrektora
    IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN
        -- Pobierz rolę osoby zmieniającej status
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = auth.uid();
        
        -- Jeśli Dyrektor zmienia status z draft na waiting
        IF v_approver_role = 'Dyrektor' THEN
            -- Pobierz kwotę faktury w PLN
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            -- Sprawdź limity dyrektora
            v_limits_check := check_director_limits(
                auth.uid(),
                v_invoice_amount,
                COALESCE(NEW.issue_date, NEW.created_at::date),
                NEW.id
            );
            
            -- Jeśli faktura mieści się w limitach dyrektora - automatyczna akceptacja
            IF (v_limits_check->>'within_limits')::boolean = true THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();
                
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    old_values,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'approved_by_director_within_limits',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                    format('Faktura zatwierdzona przez Dyrektora w ramach limitów - %s', v_limits_check->>'message')
                );
                
                RAISE NOTICE 'Invoice % approved by Director within limits', NEW.invoice_number;
                RETURN NEW;
            END IF;
            
            -- Faktura przekracza limity - sprawdź hierarchię
            -- Sprawdź czy jest CEO
            SELECT p.id INTO v_ceo_id
            FROM profiles p
            WHERE p.role = 'CEO'
            LIMIT 1;
            
            -- Sprawdź czy dział ma parent i czy parent ma dyrektora
            SELECT d.parent_department_id INTO v_parent_dept_id
            FROM departments d
            WHERE d.id = NEW.department_id;
            
            IF v_parent_dept_id IS NOT NULL THEN
                SELECT d.director_id INTO v_parent_director_id
                FROM departments d
                WHERE d.id = v_parent_dept_id;
            END IF;
            
            -- Jeśli nie ma CEO i nie ma dyrektora w dziale nadrzędnym, zakończ workflow
            IF v_ceo_id IS NULL AND v_parent_director_id IS NULL THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();
                
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    old_values,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'approved_by_director_final',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'accepted'),
                    format('Faktura zaakceptowana przez Dyrektora (brak dalszych approverów) - %s', v_limits_check->>'message')
                );
                
                RAISE NOTICE 'Invoice % approved by Director - no further approvers', NEW.invoice_number;
            ELSIF v_ceo_id IS NOT NULL THEN
                -- Jest CEO, przekaż do niego (faktura przekracza limity)
                NEW.current_approver_id := v_ceo_id;
                
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    old_values,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'forwarded_to_ceo',
                    jsonb_build_object('status', 'draft', 'current_approver_id', NULL),
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id, 'limits_check', v_limits_check),
                    format('Faktura przekazana do CEO - %s', v_limits_check->>'message')
                );
                
                RAISE NOTICE 'Invoice % forwarded to CEO - exceeds limits', NEW.invoice_number;
            ELSIF v_parent_director_id IS NOT NULL THEN
                -- Jest dyrektor w dziale nadrzędnym
                NEW.current_approver_id := v_parent_director_id;
                
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    old_values,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'forwarded_to_parent_director',
                    jsonb_build_object('status', 'draft', 'current_approver_id', NULL),
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_parent_director_id),
                    'Faktura przekazana do Dyrektora działu nadrzędnego'
                );
                
                RAISE NOTICE 'Invoice % forwarded to parent department director', NEW.invoice_number;
            END IF;
        END IF;
    END IF;
    
    -- Tylko gdy status zmienia się na 'accepted' z 'waiting'
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        -- Pobierz rolę akceptującego
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = auth.uid();
        
        -- Kierownik akceptuje fakturę
        IF v_approver_role = 'Kierownik' THEN
            NEW.approved_by_manager_at := now();
            
            -- Sprawdź limity działu
            v_limits_check := check_department_limits(
                NEW.department_id,
                COALESCE(NEW.pln_gross_amount, NEW.gross_amount),
                COALESCE(NEW.issue_date, NEW.created_at),
                NEW.id
            );
            
            -- Jeśli przekracza limity, przekaż do Dyrektora
            IF (v_limits_check->>'within_limits')::boolean = false THEN
                -- Znajdź Dyrektora działu
                SELECT director_id, name
                INTO v_director_id, v_dept_name
                FROM departments
                WHERE id = NEW.department_id;
                
                -- Jeśli nie ma dyrektora w tabeli departments, szukaj w profiles
                IF v_director_id IS NULL THEN
                    SELECT p.id
                    INTO v_director_id
                    FROM profiles p
                    WHERE p.department_id = NEW.department_id
                    AND p.role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                -- Jeśli znaleziono Dyrektora, przekaż do niego
                IF v_director_id IS NOT NULL THEN
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_director_id;
                    
                    -- Loguj przekazanie do Dyrektora
                    INSERT INTO audit_logs (
                        invoice_id,
                        user_id,
                        action,
                        old_values,
                        new_values,
                        description
                    ) VALUES (
                        NEW.id,
                        auth.uid(),
                        'forwarded_to_director',
                        jsonb_build_object(
                            'status', 'accepted',
                            'current_approver_id', auth.uid()
                        ),
                        jsonb_build_object(
                            'status', 'waiting',
                            'current_approver_id', v_director_id,
                            'reason', v_limits_check->>'reason',
                            'message', v_limits_check->>'message'
                        ),
                        format('Faktura przekazana do Dyrektora - %s', v_limits_check->>'message')
                    );
                    
                    RAISE NOTICE 'Invoice % forwarded to Director - %', 
                        NEW.invoice_number, v_limits_check->>'message';
                ELSE
                    -- Brak Dyrektora - akceptuj mimo przekroczenia limitu
                    RAISE NOTICE 'Invoice % exceeds limits but no Director found - accepting', 
                        NEW.invoice_number;
                        
                    -- Loguj akceptację mimo przekroczenia
                    INSERT INTO audit_logs (
                        invoice_id,
                        user_id,
                        action,
                        new_values,
                        description
                    ) VALUES (
                        NEW.id,
                        auth.uid(),
                        'accepted_without_director',
                        jsonb_build_object(
                            'reason', v_limits_check->>'reason',
                            'message', v_limits_check->>'message'
                        ),
                        format('Faktura zaakceptowana przez Kierownika mimo przekroczenia limitów (brak Dyrektora) - %s', 
                               v_limits_check->>'message')
                    );
                END IF;
            ELSE
                -- Faktury mieści się w limitach - auto-akceptacja
                NEW.current_approver_id := NULL;
                
                -- Loguj auto-akceptację
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    auth.uid(),
                    'auto_accepted_within_limits',
                    jsonb_build_object(
                        'status', 'accepted',
                        'message', v_limits_check->>'message'
                    ),
                    'Faktura automatycznie zaakceptowana - mieści się w limitach działu'
                );
                
                RAISE NOTICE 'Invoice % auto-accepted - within department limits', NEW.invoice_number;
            END IF;
        
        -- Dyrektor akceptuje fakturę (zmiana waiting → accepted)
        ELSIF v_approver_role = 'Dyrektor' THEN
            NEW.approved_by_director_at := now();
            NEW.current_approver_id := NULL;
            
            -- Loguj akceptację przez Dyrektora
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                auth.uid(),
                'approved_by_director',
                jsonb_build_object('status', 'accepted'),
                'Faktura zaakceptowana przez Dyrektora'
            );
            
            RAISE NOTICE 'Invoice % approved by Director', NEW.invoice_number;
        
        -- CEO lub Admin akceptuje
        ELSIF v_approver_role IN ('CEO', 'Admin') THEN
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                auth.uid(),
                'approved_by_ceo_or_admin',
                jsonb_build_object('status', 'accepted', 'approver_role', v_approver_role),
                format('Faktura zaakceptowana przez %s', v_approver_role)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION check_director_limits IS 
'Sprawdza czy faktura mieści się w limitach dyrektora (single_invoice_limit i monthly_invoice_limit)';

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury z automatycznym sprawdzaniem limitów:
- Dyrektor zmienia draft → waiting → sprawdza limity → auto-accept jeśli OK lub przekazuje do CEO
- Kierownik akceptuje → sprawdza limity działu → auto-accept lub przekazuje do Dyrektora
- Dyrektor akceptuje waiting → finalna akceptacja';
