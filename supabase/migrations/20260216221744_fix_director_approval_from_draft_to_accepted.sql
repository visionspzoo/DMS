/*
  # Naprawa Akceptacji Faktur przez Dyrektora - Draft → Accepted
  
  ## Problem
  - Kiedy Dyrektor zmienia status faktury z 'draft' na 'waiting', system przypisuje kolejnego approvera
  - get_next_approver_in_department dla roli Dyrektora szuka CEO
  - Jeśli nie ma CEO lub dział nadrzędny nie ma dyrektora, faktura zostaje przypisana z powrotem do tego samego dyrektora
  - Status pozostaje 'waiting' zamiast przejść do 'accepted'
  
  ## Rozwiązanie
  1. Zaktualizuj funkcję handle_invoice_approval aby obsługiwała zmianę draft → waiting przez Dyrektora
  2. Jeśli Dyrektor działu zmienia status na 'waiting' i jest to ostatni poziom w hierarchii, ustaw status na 'accepted'
  3. Sprawdź czy jest CEO lub czy dział nadrzędny ma dyrektora - jeśli nie, zakończ workflow
  
  ## Przypadki
  - Dyrektor jest ostatnim approverem w hierarchii → status 'accepted'
  - Dyrektor przekazuje do CEO (jeśli istnieje) → status 'waiting', current_approver = CEO
  - Dyrektor przekazuje do dyrektora działu nadrzędnego → status 'waiting'
*/

-- Rozszerz funkcję handle_invoice_approval o obsługę draft → waiting przez Dyrektora
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
BEGIN
    -- Obsługa draft → waiting przez Dyrektora
    IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN
        -- Pobierz rolę osoby zmieniającej status
        SELECT role, department_id 
        INTO v_approver_role, v_approver_dept_id
        FROM profiles
        WHERE id = auth.uid();
        
        -- Jeśli Dyrektor zmienia status z draft na waiting, sprawdź czy jest kolejny approver
        IF v_approver_role = 'Dyrektor' THEN
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
                    'Faktura zaakceptowana przez Dyrektora (brak dalszych approverów w hierarchii)'
                );
                
                RAISE NOTICE 'Invoice % approved by Director - no further approvers', NEW.invoice_number;
            ELSIF v_ceo_id IS NOT NULL THEN
                -- Jest CEO, przekaż do niego
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
                    jsonb_build_object('status', 'waiting', 'current_approver_id', v_ceo_id),
                    'Faktura przekazana do CEO do akceptacji'
                );
                
                RAISE NOTICE 'Invoice % forwarded to CEO', NEW.invoice_number;
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
        
        -- Dyrektor akceptuje fakturę
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

-- Zaktualizuj trigger aby obsługiwał również draft → waiting
DROP TRIGGER IF EXISTS invoice_approval_workflow_trigger ON invoices;
CREATE TRIGGER invoice_approval_workflow_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    WHEN (
        (NEW.status = 'accepted' AND OLD.status = 'waiting') OR
        (NEW.status = 'waiting' AND OLD.status = 'draft')
    )
    EXECUTE FUNCTION handle_invoice_approval();

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury:
- Dyrektor zmienia draft → waiting → sprawdza hierarchię → finalizuje jeśli brak dalszych approverów
- Kierownik akceptuje → sprawdza limity → auto-accept lub przekazuje do Dyrektora
- Dyrektor akceptuje → finalna akceptacja';
