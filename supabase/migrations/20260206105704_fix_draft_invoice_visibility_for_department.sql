/*
  # Fix Draft Invoice Visibility for Department Members

  ## Problem
  - KSEF invoices transferred to departments have uploaded_by = NULL and status = 'draft'
  - Current RLS policy only shows drafts to the uploader (uploaded_by = auth.uid())
  - This means KSEF invoices with draft status are invisible to everyone
  
  ## Solution
  - Allow users to see draft invoices from their department (not just their own drafts)
  - Maintain privacy: users can only see drafts from their department, not all drafts
  
  ## Changes
  - Update RLS policy to include draft invoices from user's department
  - CEO: Sees all invoices (including all drafts)
  - Dyrektor: Sees drafts from their department tree
  - Kierownik: Sees drafts from their department
  - Specjalista: Sees drafts from their department
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- User's own invoices (including drafts)
    (uploaded_by = auth.uid())
    OR
    -- Invoices visible based on role (including drafts from user's department)
    (
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
      -- Kierownik can see invoices from their department (excluding Dyrektor uploads for non-draft)
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id
          LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
          WHERE id.invoice_id = invoices.id
          AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          AND (invoices.status = 'draft' OR uploader.role IS NULL OR uploader.role != 'Dyrektor')
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
    )
  );
