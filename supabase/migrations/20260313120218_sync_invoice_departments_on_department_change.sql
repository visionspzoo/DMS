/*
  # Sync invoice_departments when department_id changes

  ## Problem
  When an invoice is transferred to a new department (department_id changes on UPDATE),
  the invoice_departments table is not updated - it only has entries from INSERT time.
  This causes RLS SELECT policies for Kierownik/Dyrektor to fail because they check
  invoice_departments, not invoices.department_id directly.

  ## Changes
  - New function: sync_invoice_departments_on_update()
    Removes old primary department entry and adds new one when department_id changes
  - New trigger: sync_invoice_departments_update_trigger
    Fires AFTER UPDATE on invoices when department_id changes
*/

CREATE OR REPLACE FUNCTION sync_invoice_departments_on_update()
RETURNS TRIGGER AS $$
DECLARE
  dept_record record;
BEGIN
  -- Only act when department_id actually changes
  IF OLD.department_id IS DISTINCT FROM NEW.department_id AND NEW.department_id IS NOT NULL THEN
    -- Remove old primary department entry
    IF OLD.department_id IS NOT NULL THEN
      DELETE FROM invoice_departments
      WHERE invoice_id = NEW.id
        AND department_id = OLD.department_id
        AND is_primary = true;
    END IF;

    -- Add new department and its hierarchy
    FOR dept_record IN
      SELECT department_id, level
      FROM get_department_hierarchy(NEW.department_id)
    LOOP
      INSERT INTO invoice_departments (invoice_id, department_id, is_primary)
      VALUES (
        NEW.id,
        dept_record.department_id,
        dept_record.level = 0
      )
      ON CONFLICT (invoice_id, department_id) DO UPDATE
        SET is_primary = EXCLUDED.is_primary;
    END LOOP;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_invoice_departments_update_trigger ON invoices;

CREATE TRIGGER sync_invoice_departments_update_trigger
  AFTER UPDATE OF department_id ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION sync_invoice_departments_on_update();
