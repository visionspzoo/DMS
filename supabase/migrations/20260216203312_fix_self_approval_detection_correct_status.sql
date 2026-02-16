/*
  # Naprawa Wykrywania Samo-Zatwierdzania - Poprawka Statusów

  ## Problem
  - Poprzednia migracja używała nieistniejących statusów ('accepted_director')
  - Dozwolone statusy to: 'draft', 'waiting', 'pending', 'in_review', 'approved', 'accepted', 'rejected', 'paid'

  ## Rozwiązanie
  - Zaktualizuj funkcję prevent_self_approval()
  - Gdy wykryje samo-zatwierdzenie:
    - Zmień status na 'accepted' (faktura zatwierdzona automatycznie)
    - Wyczyść current_approver_id (NULL)
  - System powinien następnie przesunąć fakturę dalej w workflow jeśli potrzeba
*/

-- Zaktualizowana funkcja wykrywająca i rozwiązująca problem samo-zatwierdzania
CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_ceo_id uuid;
BEGIN
    -- Sprawdź tylko jeśli status zmienia się na 'waiting'
    IF NEW.status = 'waiting' AND OLD.status != 'waiting' THEN
        -- Sprawdź czy current_approver_id == uploaded_by
        IF NEW.current_approver_id = NEW.uploaded_by THEN
            -- Pobierz rolę uploadera i department_id
            SELECT role, department_id 
            INTO v_uploader_role, v_department_id
            FROM profiles
            WHERE id = NEW.uploaded_by;
            
            -- Znajdź CEO
            SELECT id INTO v_ceo_id
            FROM profiles
            WHERE role = 'CEO'
            LIMIT 1;
            
            -- Jeśli uploader jest Dyrektorem lub wyższym, automatycznie zaakceptuj
            -- i przekaż do CEO (lub zakończ jeśli uploader to CEO)
            IF v_uploader_role IN ('Dyrektor', 'CEO') THEN
                IF v_uploader_role = 'CEO' OR v_ceo_id = NEW.uploaded_by THEN
                    -- CEO nie może zatwierdzać własnych faktur - oznacz jako zaakceptowaną
                    NEW.status := 'accepted';
                    NEW.current_approver_id := NULL;
                ELSE
                    -- Dyrektor - przekaż do CEO
                    NEW.status := 'waiting';
                    NEW.current_approver_id := v_ceo_id;
                END IF;
                
            ELSIF v_uploader_role = 'Kierownik' THEN
                -- Kierownik - przekaż do Dyrektora
                SELECT director_id INTO v_next_approver_id
                FROM departments
                WHERE id = COALESCE(NEW.department_id, v_department_id);
                
                -- Jeśli nie ma dyrektora w dziale, szukaj w profilach
                IF v_next_approver_id IS NULL THEN
                    SELECT id INTO v_next_approver_id
                    FROM profiles
                    WHERE department_id = COALESCE(NEW.department_id, v_department_id)
                    AND role = 'Dyrektor'
                    LIMIT 1;
                END IF;
                
                -- Jeśli nadal nie ma dyrektora, przekaż do CEO
                IF v_next_approver_id IS NULL THEN
                    v_next_approver_id := v_ceo_id;
                END IF;
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
                
            ELSE
                -- Dla Specjalisty lub innych ról - użyj standardowej funkcji
                v_next_approver_id := get_next_approver_in_department(
                    COALESCE(NEW.department_id, v_department_id),
                    v_uploader_role
                );
                
                NEW.status := 'waiting';
                NEW.current_approver_id := v_next_approver_id;
            END IF;
            
            -- Zaloguj automatyczne zatwierdzenie/przekierowanie
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                NEW.uploaded_by,
                'auto_reassigned',
                jsonb_build_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'reason', 'self_approval_detected',
                    'uploader_role', v_uploader_role,
                    'old_approver_id', OLD.current_approver_id,
                    'new_approver_id', NEW.current_approver_id
                ),
                format('Faktura automatycznie przekierowana - wykryto próbę samo-zatwierdzenia (%s → %s)', 
                    v_uploader_role, 
                    CASE 
                        WHEN NEW.current_approver_id IS NULL THEN 'zatwierdzona'
                        ELSE 'przekazana dalej'
                    END)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
