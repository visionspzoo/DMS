/*
  # Naprawa Sprawdzania Limitów Dyrektora przy Akceptacji Faktur od Kierownika

  ## Problem
  - Gdy Dyrektor akceptuje fakturę przesłaną przez Kierownika (waiting → accepted), nie są sprawdzane limity
  - Funkcja check_director_limits działa tylko gdy Dyrektor sam przesyła fakturę (draft → waiting)
  - Faktury przekraczające limity Dyrektora powinny być przekazywane do CEO

  ## Rozwiązanie
  1. Dodaj sprawdzanie limitów Dyrektora także przy akceptacji faktur od Kierownika (waiting → accepted)
  2. Jeśli faktura mieści się w limitach → status 'accepted', current_approver_id = NULL
  3. Jeśli przekracza limity → przekaż do CEO
  
  ## Przypadki
  - Dyrektor akceptuje fakturę Kierownika w ramach limitów → automatyczna akceptacja (status = 'accepted')
  - Dyrektor akceptuje fakturę przekraczającą limity → przekazanie do CEO (status = 'waiting')
  - Brak CEO → faktura zostaje zaakceptowana mimo przekroczenia limitów
*/

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
            -- Pobierz kwotę faktury w PLN
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            -- Sprawdź limity dyrektora
            v_limits_check := check_director_limits(
                auth.uid(),
                v_invoice_amount,
                COALESCE(NEW.issue_date, NEW.created_at::date),
                NEW.id
            );
            
            -- Jeśli faktura mieści się w limitach dyrektora - akceptacja
            IF (v_limits_check->>'within_limits')::boolean = true THEN
                NEW.approved_by_director_at := now();
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
                    'approved_by_director',
                    jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                    format('Faktura zaakceptowana przez Dyrektora - %s', v_limits_check->>'message')
                );
                
                RAISE NOTICE 'Invoice % approved by Director within limits', NEW.invoice_number;
            ELSE
                -- Faktura przekracza limity - sprawdź czy jest CEO
                SELECT p.id INTO v_ceo_id
                FROM profiles p
                WHERE p.role = 'CEO'
                LIMIT 1;
                
                IF v_ceo_id IS NOT NULL THEN
                    -- Jest CEO, przekaż do niego
                    NEW.status := 'waiting';
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
                        'forwarded_to_ceo_exceeds_limits',
                        jsonb_build_object('status', 'waiting', 'current_approver_id', auth.uid()),
                        jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id, 'limits_check', v_limits_check),
                        format('Faktura przekazana do CEO - %s', v_limits_check->>'message')
                    );
                    
                    RAISE NOTICE 'Invoice % forwarded to CEO - exceeds director limits', NEW.invoice_number;
                ELSE
                    -- Brak CEO - akceptuj mimo przekroczenia limitów
                    NEW.approved_by_director_at := now();
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
                        'approved_by_director_no_ceo',
                        jsonb_build_object('status', 'accepted', 'limits_check', v_limits_check),
                        format('Faktura zaakceptowana przez Dyrektora mimo przekroczenia limitów (brak CEO) - %s', v_limits_check->>'message')
                    );
                    
                    RAISE NOTICE 'Invoice % approved by Director - no CEO found', NEW.invoice_number;
                END IF;
            END IF;
        
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

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury z automatycznym sprawdzaniem limitów:
- Dyrektor przesyła fakturę (draft → waiting) → sprawdza limity → auto-accept jeśli OK lub przekazuje do CEO
- Kierownik akceptuje → sprawdza limity działu → auto-accept lub przekazuje do Dyrektora  
- Dyrektor akceptuje fakturę od Kierownika (waiting → accepted) → sprawdza limity → auto-accept lub przekazuje do CEO
- CEO akceptuje → finalna akceptacja';
