/*
  # Aktualizacja prevent_self_approval - Pomiń Dyrektorów

  ## Zmiana
  Funkcja prevent_self_approval() nie powinna ingerować w workflow dyrektorów.
  Dyrektorzy są obsługiwani w całości przez handle_invoice_approval().
  
  ## Logika
  - Jeśli uploader jest Dyrektorem → pomiń (handle_invoice_approval obsługuje)
  - Dla innych ról (Kierownik, Specjalista) → standardowa logika
*/

CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_original_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_ceo_id uuid;
BEGIN
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
Dyrektorzy są obsługiwani przez handle_invoice_approval() i pomijani tutaj.';
