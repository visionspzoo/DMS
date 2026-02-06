/*
  # Fix RLS Policy for Draft Invoice Visibility

  ## Problem
  - Previous policy has complex LEFT JOIN logic that doesn't work correctly
  - Users cannot see their own invoices or department invoices
  
  ## Solution
  - Simplify the policy logic
  - Separate conditions more clearly
  - Fix Kierownik condition to properly handle drafts
  
  ## Changes
  - Simplify policy to be more explicit about each role's permissions
  - Remove problematic LEFT JOIN logic
  - Ensure uploaded_by check works correctly
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
