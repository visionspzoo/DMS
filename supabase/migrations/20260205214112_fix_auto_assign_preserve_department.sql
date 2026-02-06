/*
  # Fix auto_assign_invoice_departments to preserve manual department selection

  ## Changes
  - Modify `auto_assign_invoice_departments` function to preserve department_id if already set
  - This allows KSEF invoices to be assigned to specific departments by users
  - If department_id is NULL, it will still auto-assign from user's profile

  ## Reasoning
  - When transferring KSEF invoices, users manually select the target department
  - The trigger should respect this manual selection
  - Only auto-assign if no department was specified
*/

CREATE OR REPLACE FUNCTION auto_assign_invoice_departments()
RETURNS TRIGGER AS $$
DECLARE
  target_dept_id uuid;
  dept_record record;
BEGIN
  -- Sprawdź, czy department_id został już ustawiony (np. przez użytkownika)
  IF NEW.department_id IS NOT NULL THEN
    -- Użyj ręcznie ustawionego działu
    target_dept_id := NEW.department_id;
  ELSE
    -- Pobierz department_id użytkownika tworzącego fakturę
    SELECT department_id INTO target_dept_id
    FROM profiles
    WHERE id = NEW.uploaded_by;
    
    -- Jeśli użytkownik ma przypisany dział, ustaw go jako główny dział faktury
    IF target_dept_id IS NOT NULL THEN
      UPDATE invoices 
      SET department_id = target_dept_id 
      WHERE id = NEW.id;
    END IF;
  END IF;
  
  -- Jeśli mamy dział docelowy (ręczny lub z profilu)
  IF target_dept_id IS NOT NULL THEN
    -- Przypisz dział i wszystkie działy nadrzędne do invoice_departments
    FOR dept_record IN 
      SELECT department_id, level 
      FROM get_department_hierarchy(target_dept_id)
    LOOP
      INSERT INTO invoice_departments (invoice_id, department_id, is_primary)
      VALUES (
        NEW.id, 
        dept_record.department_id, 
        dept_record.level = 0  -- Główny dział (poziom 0)
      )
      ON CONFLICT (invoice_id, department_id) DO NOTHING;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
