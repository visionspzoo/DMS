/*
  # Fix Draft Invoice Visibility - Show Only Assigned Drafts

  ## Problem
  - Current RLS allows users to see ALL draft invoices from their department
  - Users should only see draft invoices that are assigned to them (current_approver_id)
  - This causes KSEF draft invoices to be visible to everyone in the department

  ## Solution
  - For draft invoices: only show to uploader OR current_approver
  - For non-draft invoices: apply existing role-based rules

  ## Changes
  1. Update SELECT policy to restrict draft visibility
  2. Draft invoices visible only if:
     - User is the uploader (uploaded_by = auth.uid())
     - User is assigned as approver (current_approver_id = auth.uid())
     - User is CEO or Admin (can see all)
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- CEO can see all invoices (including all drafts)
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Admin can see all invoices
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- For DRAFT invoices: only uploader or assigned approver can see
    (
      invoices.status = 'draft'
      AND (
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
      )
    )
    OR
    -- For NON-DRAFT invoices: apply role-based visibility
    (
      invoices.status != 'draft'
      AND (
        -- User's own invoices
        uploaded_by = auth.uid()
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
        -- Kierownik can see invoices from their department (excluding Dyrektor uploads)
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND (uploader.role IS NULL OR uploader.role != 'Dyrektor')
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
    )
  );
