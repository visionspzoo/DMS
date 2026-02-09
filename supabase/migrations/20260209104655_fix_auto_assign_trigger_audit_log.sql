/*
  # Naprawa Triggera Auto-przypisania
  
  1. Problem
    - Trigger BEFORE INSERT próbuje dodać audit_log przed zapisaniem faktury
    - Foreign key constraint fail bo faktura jeszcze nie istnieje
    
  2. Rozwiązanie
    - Usuń logowanie z BEFORE trigger
    - Dodaj osobny AFTER INSERT trigger do logowania
*/

-- Zaktualizuj funkcję - usuń logowanie z BEFORE triggera
CREATE OR REPLACE FUNCTION auto_assign_invoice_to_approver()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
    v_uploader_dept_id uuid;
    v_next_approver_id uuid;
BEGIN
    -- Pobierz rolę i dział uploadującego
    SELECT role, department_id 
    INTO v_uploader_role, v_uploader_dept_id
    FROM profiles
    WHERE id = NEW.uploaded_by;
    
    -- Jeśli status to 'waiting' i brak current_approver_id, przypisz następnego akceptującego
    IF NEW.status = 'waiting' AND NEW.current_approver_id IS NULL THEN
        v_next_approver_id := get_next_approver_in_department(
            COALESCE(NEW.department_id, v_uploader_dept_id), 
            v_uploader_role
        );
        
        IF v_next_approver_id IS NOT NULL THEN
            NEW.current_approver_id := v_next_approver_id;
        END IF;
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nowa funkcja do logowania przypisania (AFTER INSERT)
CREATE OR REPLACE FUNCTION log_invoice_assignment()
RETURNS trigger AS $$
DECLARE
    v_uploader_role text;
BEGIN
    -- Jeśli faktura ma przypisanego akceptującego, zaloguj to
    IF NEW.current_approver_id IS NOT NULL AND NEW.status = 'waiting' THEN
        SELECT role INTO v_uploader_role
        FROM profiles
        WHERE id = NEW.uploaded_by;
        
        INSERT INTO audit_logs (
            invoice_id,
            user_id,
            action,
            new_values,
            description
        ) VALUES (
            NEW.id,
            NEW.uploaded_by,
            'assigned_to_approver',
            jsonb_build_object(
                'current_approver_id', NEW.current_approver_id,
                'uploader_role', v_uploader_role
            ),
            format('Faktura przypisana do akceptującego (rola uploadera: %s)', v_uploader_role)
        );
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Dodaj AFTER INSERT trigger do logowania
DROP TRIGGER IF EXISTS invoice_assignment_log_trigger ON invoices;
CREATE TRIGGER invoice_assignment_log_trigger
    AFTER INSERT ON invoices
    FOR EACH ROW
    WHEN (NEW.current_approver_id IS NOT NULL)
    EXECUTE FUNCTION log_invoice_assignment();
