/*
  # Fix: Admins Should Not See All Draft Invoices

  ## Problem
  - Current policy allows is_admin = true to see ALL invoices including drafts
  - This causes users with admin flag to see draft invoices from other departments
  - Draft invoices should ONLY be visible to uploader or assigned approver (except CEO)

  ## Solution
  - Remove is_admin check from draft visibility
  - Only CEO should see all drafts
  - Admins can still see non-draft invoices based on their role
  - Draft invoices: only uploader, current_approver, or CEO

  ## Changes
  1. Remove is_admin from top-level OR conditions
  2. Keep is_admin only for non-draft invoice visibility based on role
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
    -- For DRAFT invoices: only uploader or assigned approver can see (NOT regular admins)
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
        -- Admins can see all non-draft invoices
        (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
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
