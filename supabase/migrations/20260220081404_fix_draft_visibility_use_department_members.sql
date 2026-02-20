/*
  # Fix draft invoice visibility using department_members table

  ## Problem
  Previous policy relied on profiles.department_id to determine department membership
  for managers and directors. However, the actual membership source-of-truth is the
  department_members table (user_id + department_id). Additionally, director scope
  for some departments is stored in departments.director_id but managers also use
  department_members and departments.manager_id.

  ## Solution
  Rewrite the SELECT policy to use department_members as primary membership check:

  ### Draft invoice visibility:
  - **Specjalista**: own drafts only
  - **Kierownik**: own drafts + drafts from Specjalista who share a department
    where Kierownik is a member (via department_members) AND the department
    either has manager_id = Kierownik OR Kierownik is in department_members for it
  - **Dyrektor**: own drafts + drafts from Kierownik/Specjalista in departments
    where Dyrektor is director (departments.director_id) OR Dyrektor is in
    department_members for that department
  - **CEO / Admin**: all invoices

  ## Key change
  Use department_members to check both uploader's department and manager's department
  so all membership assignments are respected regardless of which mechanism was used.
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
ON invoices
FOR SELECT
TO authenticated
USING (
  -- CEO sees everything
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'

  -- Admin sees everything
  OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true

  -- DRAFT invoices: hierarchical supervisor visibility
  OR (
    status = 'draft'
    AND (
      -- Always see own drafts
      uploaded_by = auth.uid()
      OR current_approver_id = auth.uid()

      -- Kierownik sees drafts from Specjalista in a shared department
      -- A shared department is one where BOTH the Kierownik and the uploader are members
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND (
          SELECT role FROM profiles WHERE id = invoices.uploaded_by
        ) = 'Specjalista'
        AND EXISTS (
          SELECT 1 FROM department_members dm_manager
          WHERE dm_manager.user_id = auth.uid()
            AND dm_manager.department_id = invoices.department_id
        )
        AND EXISTS (
          SELECT 1 FROM department_members dm_uploader
          WHERE dm_uploader.user_id = invoices.uploaded_by
            AND dm_uploader.department_id = invoices.department_id
        )
      )

      -- Dyrektor sees drafts from Kierownik or Specjalista in their managed departments
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND (
          SELECT role FROM profiles WHERE id = invoices.uploaded_by
        ) = ANY(ARRAY['Specjalista', 'Kierownik'])
        AND (
          -- Department has director_id pointing to this user
          invoices.department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          -- OR director is a member of that department
          OR EXISTS (
            SELECT 1 FROM department_members dm_dir
            WHERE dm_dir.user_id = auth.uid()
              AND dm_dir.department_id = invoices.department_id
          )
          -- OR invoice is linked via invoice_departments to a dept where user is director
          OR EXISTS (
            SELECT 1 FROM invoice_departments id2
            JOIN departments d ON d.id = id2.department_id
            WHERE id2.invoice_id = invoices.id
              AND (
                d.director_id = auth.uid()
                OR EXISTS (
                  SELECT 1 FROM department_members dm_dir2
                  WHERE dm_dir2.user_id = auth.uid()
                    AND dm_dir2.department_id = d.id
                )
              )
          )
        )
      )
    )
  )

  -- NON-DRAFT invoices: existing broad visibility rules
  OR (
    status <> 'draft'
    AND (
      uploaded_by = auth.uid()
      OR current_approver_id = auth.uid()

      -- Dyrektor sees all non-draft invoices from their departments
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND (
          department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          OR EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.user_id = auth.uid()
              AND dm.department_id = invoices.department_id
          )
          OR EXISTS (
            SELECT 1 FROM invoice_departments id2
            WHERE id2.invoice_id = invoices.id
              AND id2.department_id IN (
                SELECT id FROM departments WHERE director_id = auth.uid()
              )
          )
        )
      )

      -- Kierownik sees all non-draft invoices in their departments
      -- (excluding those uploaded by Dyrektor)
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id2
          LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
          WHERE id2.invoice_id = invoices.id
            AND id2.department_id IN (
              SELECT department_id FROM department_members WHERE user_id = auth.uid()
            )
            AND (uploader.role IS NULL OR uploader.role <> 'Dyrektor')
        )
      )

      -- Specjalista sees non-draft invoices in their department
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id2
          WHERE id2.invoice_id = invoices.id
            AND id2.department_id IN (
              SELECT department_id FROM department_members WHERE user_id = auth.uid()
            )
        )
      )

      -- user_department_access grants
      OR EXISTS (
        SELECT 1 FROM user_department_access uda
        WHERE uda.user_id = auth.uid()
          AND uda.department_id = invoices.department_id
          AND uda.access_type IN ('view', 'workflow')
      )
    )
  )
);
