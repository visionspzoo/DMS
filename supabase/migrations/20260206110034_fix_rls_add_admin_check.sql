/*
  # Fix RLS Policy - Add Admin Check

  ## Problem
  - Users with is_admin=true should see all invoices like CEO
  - Current policy doesn't account for admin flag
  
  ## Solution
  - Add admin check at the beginning of policy
  - Admins see everything like CEO
  
  ## Changes
  - Add condition to check is_admin flag
  - Place it early in the policy for performance
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- User's own invoices (including drafts)
    uploaded_by = auth.uid()
    OR
    -- Admins can see all invoices
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEO can see all invoices
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Dyrektor can see invoices from their department tree
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id IN (
          WITH RECURSIVE dept_tree AS (
            SELECT d.id FROM departments d
            WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            UNION ALL
            SELECT d.id FROM departments d
            JOIN dept_tree dt ON d.parent_department_id = dt.id
          )
          SELECT id FROM dept_tree
        )
      )
    )
    OR
    -- Kierownik can see invoices from their department
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
      -- Exclude non-draft invoices uploaded by Dyrektor (but allow drafts from anyone)
      AND (
        status = 'draft'
        OR uploaded_by IS NULL
        OR NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = invoices.uploaded_by
          AND p.role = 'Dyrektor'
        )
      )
    )
    OR
    -- Specjalista can see invoices from their department
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
    )
  );
