/*
  # Fix: Allow department-based visibility for draft invoices

  ## Root Cause
  
  When a user transfers a draft invoice to another department, PostgreSQL 
  requires that the NEW row (after UPDATE) also passes the SELECT policy.
  
  The current SELECT policy only shows draft invoices to:
  - uploaded_by (the uploader)
  - current_approver_id (the assigned approver)
  
  After a department transfer, BOTH of these change to someone else, so the 
  transferring user can no longer "see" the new row. PostgreSQL interprets 
  this as a WITH CHECK violation and throws:
  "new row violates row-level security policy for table invoices"
  
  ## Solution
  
  Expand the SELECT policy for draft invoices to ALSO allow visibility based 
  on department membership, matching the same logic used for non-draft invoices.
  This way, after a transfer, the row still passes SELECT because the user's
  department matches.
  
  ## Changes
  
  - Updated SELECT policy "Users can view invoices based on role and department"
  - Draft invoices now visible to:
    - uploaded_by OR current_approver_id (as before)
    - Kierownik: if invoice department matches their department
    - Dyrektor: if invoice department is in their department tree
    - Specjalista: if invoice department matches their department
    
  ## Security
  
  - No change to non-draft invoice visibility
  - Draft visibility still requires department membership
  - CEO and Admin access unchanged
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
ON invoices
FOR SELECT
TO authenticated
USING (
  -- CEO can see everything
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Admin can see everything
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  OR
  -- Draft invoices: visible to uploader, approver, or department members
  (
    status = 'draft'
    AND (
      uploaded_by = auth.uid()
      OR current_approver_id = auth.uid()
      OR department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND department_id IN (
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
  )
  OR
  -- Non-draft invoices
  (
    status <> 'draft'
    AND (
      uploaded_by = auth.uid()
      OR
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
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id
          LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
          WHERE id.invoice_id = invoices.id
          AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          AND (uploader.role IS NULL OR uploader.role <> 'Dyrektor')
        )
      )
      OR
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
