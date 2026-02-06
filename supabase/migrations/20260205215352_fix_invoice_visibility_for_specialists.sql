/*
  # Fix Invoice Visibility for Specialists

  ## Problem
  - Specialists could only see their own invoices (uploaded_by = auth.uid())
  - When a specialist transfers a KSEF invoice to a department, other specialists in that department cannot see it
  - This breaks the workflow where all department members should see invoices assigned to their department

  ## Changes
  - Update RLS policy to allow Specialists to see all invoices from their department (not just their own)
  - Maintain the draft privacy rule (drafts are only visible to uploader)

  ## New Logic
  - CEO: Sees all non-draft invoices
  - Dyrektor: Sees non-draft invoices from their department tree
  - Kierownik: Sees non-draft invoices from their department (excluding Dyrektor uploads)
  - Specjalista: Sees own invoices (including drafts) AND non-draft invoices from their department
  
  ## Security
  - Draft invoices remain private to the creator
  - Non-draft invoices are visible to all department members
  - Maintains role-based hierarchical access
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
    -- Non-draft invoices visible based on role
    (
      status != 'draft'
      AND
      (
        -- CEO can see all non-draft invoices
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
        OR
        -- Dyrektor can see non-draft invoices from their department tree
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
        -- Kierownik can see non-draft invoices from their department (excluding Dyrektor uploads)
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND uploader.role != 'Dyrektor'
          )
        )
        OR
        -- Specjalista can see non-draft invoices from their department
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          )
        )
      )
    )
  );
