/*
  # Naprawa Wykrywania Samo-Zatwierdzania Faktur

  ## Problem
  - Dyrektor tworzy fakturę i zostaje przypisany jako current_approver
  - System wymaga od niego zatwierdzenia własnej faktury
  - To narusza zasadę, że nikt nie może zatwierdzać własnych faktur

  ## Rozwiązanie
  - Dodaj trigger BEFORE UPDATE, który wykrywa sytuację gdy:
    - Status zmienia się na 'waiting'
    - current_approver_id == uploaded_by
  - W takiej sytuacji automatycznie zatwierdź fakturę i przekaż do następnego poziomu
  - Zaloguj akcję w audit_logs

  ## Logika
  1. Jeśli Dyrektor jest właścicielem i akceptującym:
     - Automatycznie zmień status na 'accepted_director'
     - Przypisz fakturę do CEO
  2. Jeśli Kierownik jest właścicielem i akceptującym:
     - Automatycznie zmień status na 'accepted_manager'
     - Przypisz fakturę do Dyrektora
  3. Jeśli Specjalista jest właścicielem i akceptującym:
     - Automatycznie zatwierdź i przypisz do Kierownika/Dyrektora
*/

-- Funkcja wykrywająca i rozwiązująca problem samo-zatwierdzania
CREATE OR REPLACE FUNCTION prevent_self_approval()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_department_id uuid;
    v_next_approver_id uuid;
    v_new_status text;
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
            
            -- Określ nowy status i znajdź następnego akceptującego
            IF v_uploader_role = 'Dyrektor' THEN
                v_new_status := 'accepted_director';
                -- Przypisz do CEO
                SELECT id INTO v_next_approver_id
                FROM profiles
                WHERE role = 'CEO'
                LIMIT 1;
                
            ELSIF v_uploader_role = 'Kierownik' THEN
                v_new_status := 'accepted_manager';
                -- Przypisz do Dyrektora działu
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
                
            ELSE
                -- Dla Specjalisty lub innych ról
                v_new_status := 'waiting';
                -- Użyj standardowej funkcji do znalezienia następnego akceptującego
                v_next_approver_id := get_next_approver_in_department(
                    COALESCE(NEW.department_id, v_department_id),
                    v_uploader_role
                );
            END IF;
            
            -- Zaktualizuj fakturę
            NEW.status := v_new_status;
            NEW.current_approver_id := v_next_approver_id;
            
            -- Zaloguj automatyczne zatwierdzenie
            INSERT INTO audit_logs (
                invoice_id,
                user_id,
                action,
                new_values,
                description
            ) VALUES (
                NEW.id,
                NEW.uploaded_by,
                'auto_approved',
                jsonb_build_object(
                    'old_status', OLD.status,
                    'new_status', NEW.status,
                    'reason', 'self_approval_detected',
                    'uploader_role', v_uploader_role,
                    'next_approver_id', v_next_approver_id
                ),
                format('Faktura automatycznie zatwierdzona - wykryto próbę samo-zatwierdzenia (%s)', v_uploader_role)
            );
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dodaj trigger BEFORE UPDATE
DROP TRIGGER IF EXISTS prevent_self_approval_trigger ON invoices;
CREATE TRIGGER prevent_self_approval_trigger
    BEFORE UPDATE OF status, current_approver_id ON invoices
    FOR EACH ROW
    EXECUTE FUNCTION prevent_self_approval();
