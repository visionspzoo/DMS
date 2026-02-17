/*
  # Naprawa Kolejności Workflow Akceptacji Dyrektora

  ## Problem
  1. Dyrektor (Adrian) jest uploaded_by faktury (zmienione przez system)
  2. Trigger prevent_self_approval() wykrywa current_approver_id = uploaded_by
  3. System przekazuje fakturę do CEO mimo że Adrian nie jest oryginalnym twórcą
  4. Trigger handle_invoice_approval() nie uruchamia się lub nie sprawdza limitów
  
  ## Rozwiązanie
  1. Zmień kolejność triggerów - handle_invoice_approval() PRZED prevent_self_approval()
  2. W handle_invoice_approval() sprawdzaj limity ZANIM prevent_self_approval() wykryje "samo-zatwierdzenie"
  3. Jeśli dyrektor zatwierdza fakturę w limitach - zakończ workflow (status=accepted, approver=NULL)
  4. Tylko wtedy prevent_self_approval() nie będzie potrzebny
*/

-- Usuń istniejące triggery
DROP TRIGGER IF EXISTS handle_invoice_approval_trigger ON invoices;
DROP TRIGGER IF EXISTS prevent_self_approval_trigger ON invoices;

-- Zaktualizuj funkcję handle_invoice_approval aby była bardziej kompletna
CREATE OR REPLACE FUNCTION handle_invoice_approval()
RETURNS trigger AS $$
DECLARE
    v_approver_role text;
    v_approver_dept_id uuid;
    v_limits_check jsonb;
    v_director_id uuid;
    v_dept_name text;
    v_ceo_id uuid;
    v_invoice_amount numeric;
BEGIN
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
            -- KRYTYCZNE: Sprawdź czy to samo-zatwierdzenie (original_uploader = dyrektor)
            IF NEW.original_uploader_id = v_director_id THEN
                -- To jest prawdziwe samo-zatwierdzenie - przekaż do CEO
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
                        description
                    ) VALUES (
                        NEW.id,
                        v_director_id,
                        'forwarded_to_ceo',
                        'Dyrektor stworzył fakturę - automatyczne przekazanie do CEO (nie może zatwierdzać własnych faktur)'
                    );
                ELSE
                    -- Brak CEO - auto-akceptacja
                    NEW.status := 'accepted';
                    NEW.current_approver_id := NULL;
                END IF;
                
                RETURN NEW;
            END IF;
            
            -- Nie jest samo-zatwierdzeniem - sprawdź limity
            v_invoice_amount := COALESCE(NEW.pln_gross_amount, NEW.gross_amount);
            
            -- Sprawdź limity dyrektora
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
                    format('Faktura zatwierdzona przez Dyrektora w ramach limitów (%.2f PLN)', v_invoice_amount)
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
                    format('Faktura przekazana do CEO - przekroczono limity dyrektora (%.2f PLN)', v_invoice_amount)
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
                    format('Faktura zaakceptowana przez Dyrektora (brak CEO w systemie) - %.2f PLN', v_invoice_amount)
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

-- Utwórz trigger z NAJWYŻSZYM PRIORYTETEM (uruchamia się PRZED prevent_self_approval)
-- Używamy nazwy zaczynającej się od '0' żeby był pierwszy alfabetycznie
CREATE TRIGGER z0_handle_invoice_approval_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION handle_invoice_approval();

-- Teraz utwórz ponownie prevent_self_approval (będzie działał DRUGI)
-- Ale już nie będzie potrzebny dla dyrektorów bo handle_invoice_approval obsługuje wszystko
CREATE TRIGGER z1_prevent_self_approval_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    WHEN (NEW.status = 'waiting' AND OLD.status != 'waiting')
    EXECUTE FUNCTION prevent_self_approval();

COMMENT ON FUNCTION handle_invoice_approval IS 
'Obsługuje workflow akceptacji faktury przez Dyrektora:
- Draft → Waiting: sprawdza limity dyrektora i auto-akceptuje lub przekazuje do CEO
- Waiting → Accepted: finalizuje akceptację przez Dyrektora/CEO';
