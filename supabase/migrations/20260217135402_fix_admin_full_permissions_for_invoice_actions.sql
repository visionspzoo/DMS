/*
  # Napraw uprawnienia adminów do akcji na fakturach

  ## Problem
  Admini (is_admin = true) nie mogą:
  - Akceptować faktur (zmiana statusu)
  - Przesyłać faktur do innych działów
  - Oznaczać faktur jako opłacone
  
  ## Przyczyna
  Funkcje triggerów (handle_invoice_approval, handle_simple_invoice_approval, prevent_self_approval)
  nie sprawdzają czy użytkownik jest adminem i stosują do nich normalne workflow.
  
  ## Rozwiązanie
  1. Zaktualizuj wszystkie funkcje triggerów aby pomijały użytkowników z is_admin = true lub role = 'CEO'
  2. Admini mogą dowolnie zmieniać statusy, działy i pola bez żadnych ograniczeń
  
  ## Zmiany
  - handle_invoice_approval: pomiń adminów i CEO
  - handle_simple_invoice_approval: pomiń adminów i CEO  
  - prevent_self_approval: pomiń adminów i CEO
*/

-- =====================================================
-- Funkcja 1: prevent_self_approval - pomiń adminów
-- =====================================================
CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_is_admin boolean;
    v_user_role text;
    v_uploader_role text;
    v_original_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_ceo_id uuid;
BEGIN
    -- Sprawdź czy użytkownik to admin lub CEO
    SELECT is_admin, role 
    INTO v_is_admin, v_user_role
    FROM profiles
    WHERE id = auth.uid();
    
    -- ADMINI I CEO POMIJANI - mogą wszystko robić bez ograniczeń
    IF v_is_admin = true OR v_user_role = 'CEO' THEN
        RETURN NEW;
    END IF;
    
    -- Sprawdź tylko jeśli status zmienia się na 'waiting'
    IF NEW.status = 'waiting' AND OLD.status != 'waiting' THEN
        -- Sprawdź czy current_approver_id == original_uploader_id
        IF NEW.current_approver_id = NEW.original_uploader_id THEN
            -- Pobierz rolę oryginalnego uploadera
            SELECT role, department_id 
            INTO v_original_uploader_role, v_department_id
            FROM profiles
            WHERE id = NEW.original_uploader_id;
            
            -- POMIŃ DYREKTORÓW - są obsługiwani przez handle_invoice_approval()
            IF v_original_uploader_role = 'Dyrektor' THEN
                RETURN NEW;
            END IF;
            
            -- Znajdź CEO
            SELECT id INTO v_ceo_id
            FROM profiles
            WHERE role = 'CEO'
            LIMIT 1;
            
            -- CEO nie może zatwierdzać własnych faktur
            IF v_original_uploader_role = 'CEO' OR v_ceo_id = NEW.original_uploader_id THEN
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                
            ELSIF v_original_uploader_role = 'Kierownik' THEN
                -- Kierownik - przekaż do Dyrektora
                SELECT director_id INTO v_next_approver_id
                FROM departments
                WHERE id = COALESCE(NEW.department_id, v_department_id);
                
                IF v_next_approver_id IS NULL THEN
                    SELECT id INTO v_next_approver_id
                    FROM profiles
                    WHERE department_id = COALESCE(NEW.department_id, v_department_id)
                    AND role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                IF v_next_approver_id IS NULL THEN
                    v_next_approver_id := v_ceo_id;
                END IF;
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
                
            ELSE
                -- Dla Specjalisty lub innych ról - użyj standardowej funkcji
                v_next_approver_id := get_next_approver_in_department(
                    COALESCE(NEW.department_id, v_department_id),
                    v_original_uploader_role
                );
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
            END IF;
            
            -- Zaloguj automatyczne przekierowanie (tylko dla nie-dyrektorów)
            IF v_original_uploader_role != 'Dyrektor' THEN
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    new_values,
                    description
                ) VALUES (
                    NEW.id,
                    NEW.original_uploader_id,
                    'auto_reassigned',
                    jsonb_build_object(
                        'old_status', OLD.status,
                        'new_status', NEW.status,
                        'reason', 'self_approval_detected',
                        'uploader_role', v_original_uploader_role,
                        'old_approver_id', OLD.current_approver_id,
                        'new_approver_id', NEW.current_approver_id
                    ),
                    format('Faktura automatycznie przekierowana - wykryto próbę samo-zatwierdzenia (%s → %s)', 
                        v_original_uploader_role, 
                        CASE 
                            WHEN NEW.current_approver_id IS NULL THEN 'zatwierdzona'
                            ELSE 'przekazana dalej'
                        END)
                );
            END IF;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION prevent_self_approval IS 
'Zapobiega samo-zatwierdzaniu faktur dla Kierowników i Specjalistów.
Admini i CEO są całkowicie pomijani.
Dyrektorzy są obsługiwani przez handle_invoice_approval() i pomijani tutaj.';

-- =====================================================
-- Funkcja 2: handle_simple_invoice_approval - pomiń adminów
-- =====================================================
CREATE OR REPLACE FUNCTION handle_simple_invoice_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_is_admin boolean;
  v_approver_role text;
  v_director_limit numeric;
  v_current_month_total numeric;
  v_ceo_id uuid;
BEGIN
  -- Sprawdź czy użytkownik to admin lub CEO
  SELECT is_admin, role 
  INTO v_is_admin, v_approver_role
  FROM profiles
  WHERE id = auth.uid();
  
  -- ADMINI I CEO POMIJANI - mogą wszystko robić bez ograniczeń
  IF v_is_admin = true OR v_approver_role = 'CEO' THEN
    RETURN NEW;
  END IF;

  -- Tylko przy zmianie waiting → accepted
  IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
    -- Dyrektor musi sprawdzić osobiste limity (suma wszystkich działów)
    IF v_approver_role = 'Dyrektor' THEN
      -- Pobierz osobisty limit dyrektora
      SELECT director_approval_limit INTO v_director_limit
      FROM profiles
      WHERE id = auth.uid();

      -- Jeśli jest limit, sprawdź czy nie został przekroczony
      IF v_director_limit IS NOT NULL THEN
        -- Oblicz sumę zaakceptowanych faktur we wszystkich działach dyrektora w tym miesiącu
        SELECT COALESCE(SUM(pln_gross_amount), 0) INTO v_current_month_total
        FROM invoices
        WHERE status IN ('accepted', 'paid')
          AND current_approver_id = auth.uid()
          AND department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);

        -- Jeśli przekroczy limit, przekaż do CEO
        IF (v_current_month_total + NEW.pln_gross_amount) > v_director_limit THEN
          SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;
          
          IF v_ceo_id IS NOT NULL THEN
            -- Przekaż do CEO zamiast akceptować
            NEW.status := 'waiting';
            NEW.current_approver_id := v_ceo_id;
            
            INSERT INTO audit_logs (invoice_id, user_id, action, description)
            VALUES (
              NEW.id,
              auth.uid(),
              'forwarded_to_ceo',
              'Faktura przekazana do CEO - przekroczono limity dyrektora'
            );
            
            RETURN NEW;
          END IF;
        END IF;
      END IF;

      -- W limitach lub brak CEO - zaakceptuj
      NEW.current_approver_id := NULL;
      NEW.approved_by_director_at := NOW();
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_simple_invoice_approval IS 
'Obsługuje proste workflow akceptacji faktury.
Admini i CEO są całkowicie pomijani i mogą wszystko robić bez ograniczeń.';

-- =====================================================
-- Funkcja 3: handle_invoice_approval - pomiń adminów
-- =====================================================
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
BEGIN
    -- Sprawdź czy użytkownik to admin lub CEO
    SELECT is_admin, role 
    INTO v_is_admin, v_user_role
    FROM profiles
    WHERE id = auth.uid();
    
    -- ADMINI I CEO POMIJANI - mogą wszystko robić bez ograniczeń
    IF v_is_admin = true OR v_user_role = 'CEO' THEN
        RETURN NEW;
    END IF;
    
    -- ==========================================
    -- OBSŁUGA: Dyrektor zmienia draft → waiting
    -- ==========================================
    IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN
        -- Pobierz ID osoby zmieniającej status (uploaded_by = dyrektor działu)
        v_director_id := NEW.uploaded_by;
        
        -- Sprawdź czy to dyrektor
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = v_director_id;
        
        -- Jeśli Dyrektor zmienia status z draft na waiting
        IF v_approver_role = 'Dyrektor' THEN
            -- Pobierz kwotę faktury w PLN
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            -- ZAWSZE sprawdź limity dyrektora (bez względu na to kto stworzył fakturę)
            v_limits_check := check_director_limits(
                v_director_id,
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
                    v_director_id,
                    'approved_by_director_within_limits',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                    format('Faktura zatwierdzona przez Dyrektora w ramach limitów (%s PLN)', v_invoice_amount::text)
                );
                
                RETURN NEW;
            END IF;
            
            -- Faktura przekracza limity - przekaż do CEO
            SELECT id INTO v_ceo_id
            FROM profiles
            WHERE role = 'CEO'
            LIMIT 1;
            
            IF v_ceo_id IS NOT NULL THEN
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
                    v_director_id,
                    'forwarded_to_ceo',
                    jsonb_build_object('status', 'draft'),
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id, 'limits_check', v_limits_check),
                    format('Faktura przekazana do CEO - przekroczono limity dyrektora (%s PLN)', v_invoice_amount::text)
                );
            ELSE
                -- Brak CEO - akceptuj mimo przekroczenia limitów
                NEW.status := 'accepted';
                NEW.current_approver_id := NULL;
                NEW.approved_by_director_at := now();
                
                INSERT INTO audit_logs (
                    invoice_id,
                    user_id,
                    action,
                    description
                ) VALUES (
                    NEW.id,
                    v_director_id,
                    'approved_by_director_no_ceo',
                    format('Faktura zaakceptowana przez Dyrektora (brak CEO w systemie) - %s PLN', v_invoice_amount::text)
                );
            END IF;
        END IF;
    END IF;
    
    -- ==========================================
    -- OBSŁUGA: Akceptacja waiting → accepted
    -- ==========================================
    IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
        -- Pobierz ID i rolę osoby akceptującej
        v_director_id := OLD.current_approver_id;
        
        SELECT role
        INTO v_approver_role
        FROM profiles
        WHERE id = v_director_id;
        
        -- Dyrektor akceptuje fakturę (z poziomu waiting)
        IF v_approver_role = 'Dyrektor' THEN
            NEW.approved_by_director_at := now();
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                description
            ) VALUES (
                NEW.id,
                v_director_id,
                'approved_by_director',
                'Faktura zaakceptowana przez Dyrektora'
            );
        
        -- CEO akceptuje
        ELSIF v_approver_role = 'CEO' THEN
            NEW.current_approver_id := NULL;
            
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                description
            ) VALUES (
                NEW.id,
                v_director_id,
                'approved_by_ceo',
                'Faktura zaakceptowana przez CEO'
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury przez Dyrektora:
- Draft → Waiting: sprawdza limity dyrektora i auto-akceptuje lub przekazuje do CEO
- Limity sprawdzane są ZAWSZE, niezależnie od tego kto stworzył fakturę
- Waiting → Accepted: finalizuje akceptację przez Dyrektora/CEO
- Admini i CEO są całkowicie pomijani i mogą wszystko robić bez ograniczeń';
