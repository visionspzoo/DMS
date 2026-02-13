/*
  # Fix admin invoice visibility - allow viewing ALL invoices including drafts

  1. Changes
    - Drop existing SELECT policy on invoices table
    - Create new SELECT policy that grants admin (is_admin=true) access to ALL invoices
      regardless of status (including drafts from other users/departments)
    - Non-admin users retain existing visibility rules:
      - CEO sees all
      - Draft: only if uploaded_by or current_approver_id
      - Non-draft: based on role and department membership

  2. Security
    - Admin access is controlled by the is_admin flag on profiles table
    - Non-admin visibility rules remain unchanged
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'CEO'
    OR
    (SELECT profiles.is_admin FROM profiles WHERE profiles.id = auth.uid()) = true
    OR
    (
      status = 'draft'
      AND (
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
      )
    )
    OR
    (
      status <> 'draft'
      AND (
        uploaded_by = auth.uid()
        OR
        (
          (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'Dyrektor'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            WHERE id.invoice_id = invoices.id
            AND id.department_id IN (
              WITH RECURSIVE dept_tree AS (
                SELECT d.id FROM departments d
                WHERE d.id = (SELECT profiles.department_id FROM profiles WHERE profiles.id = auth.uid())
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
          (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'Kierownik'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT profiles.department_id FROM profiles WHERE profiles.id = auth.uid())
            AND (uploader.role IS NULL OR uploader.role <> 'Dyrektor')
          )
        )
        OR
        (
          (SELECT profiles.role FROM profiles WHERE profiles.id = auth.uid()) = 'Specjalista'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT profiles.department_id FROM profiles WHERE profiles.id = auth.uid())
          )
        )
      )
    )
  );
