/*
  # Naprawa Format Strings w handle_invoice_approval
  
  ## Problem
  Funkcja używa %.2f w format() ale PostgreSQL wymaga %s.
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
