/*
  # Backfill invoice_departments to match invoices.department_id

  ## Problem
  Some invoices have been transferred to a different department (department_id changed)
  but invoice_departments still has entries from the original department.
  This causes RLS SELECT/UPDATE policies to fail for users in the current department.

  ## Changes
  - Fixes all invoices where invoice_departments primary entry does not match invoices.department_id
  - Removes stale primary entries and adds correct ones with hierarchy
*/

DO $$
DECLARE
  inv_record record;
  dept_record record;
BEGIN
  FOR inv_record IN
    SELECT i.id, i.department_id
    FROM invoices i
    WHERE i.department_id IS NOT NULL
    AND NOT EXISTS (
      SELECT 1 FROM invoice_departments id2
      WHERE id2.invoice_id = i.id
      AND id2.department_id = i.department_id
    )
  LOOP
    DELETE FROM invoice_departments
    WHERE invoice_id = inv_record.id
    AND is_primary = true;

    FOR dept_record IN
      SELECT department_id, level
      FROM get_department_hierarchy(inv_record.department_id)
    LOOP
      INSERT INTO invoice_departments (invoice_id, department_id, is_primary)
      VALUES (
        inv_record.id,
        dept_record.department_id,
        dept_record.level = 0
      )
      ON CONFLICT (invoice_id, department_id) DO UPDATE
        SET is_primary = EXCLUDED.is_primary;
    END LOOP;
  END LOOP;
END $$;
