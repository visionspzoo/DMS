/*
  # Fix draft invoice visibility for manager/director hierarchy

  ## Rules
  - Specialist: sees only their own drafts (uploaded_by = auth.uid())
  - Manager: sees own drafts + drafts uploaded by Specialists in the same departments
  - Director: sees own drafts + drafts uploaded by Specialists OR Managers in departments
    where the director is listed as director_id OR is a department_member
  - Admin/CEO: see all drafts (handled by separate policies)

  ## Changes
  - Drop and recreate the main SELECT policy with corrected draft visibility logic
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
ON invoices
FOR SELECT
TO authenticated
USING (
  -- CEO sees everything
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Admin sees everything (also covered by separate admin policy)
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  OR
  -- DRAFT invoices visibility
  (
    status = 'draft'
    AND (
      -- Own drafts
      uploaded_by = auth.uid()
      OR
      current_approver_id = auth.uid()
      OR
      -- Kierownik sees drafts of Specjaliści in the same department
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND (SELECT role FROM profiles WHERE id = invoices.uploaded_by) = 'Specjalista'
        AND EXISTS (
          SELECT 1 FROM department_members dm_mgr
          WHERE dm_mgr.user_id = auth.uid()
            AND dm_mgr.department_id = invoices.department_id
        )
        AND EXISTS (
          SELECT 1 FROM department_members dm_upl
          WHERE dm_upl.user_id = invoices.uploaded_by
            AND dm_upl.department_id = invoices.department_id
        )
      )
      OR
      -- Dyrektor sees drafts of Kierownicy and Specjaliści in their departments
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND (SELECT role FROM profiles WHERE id = invoices.uploaded_by) = ANY(ARRAY['Specjalista', 'Kierownik'])
        AND (
          -- Department has this director set as director_id
          invoices.department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          OR
          -- Director is a member of the department
          EXISTS (
            SELECT 1 FROM department_members dm_dir
            WHERE dm_dir.user_id = auth.uid()
              AND dm_dir.department_id = invoices.department_id
          )
        )
        AND EXISTS (
          SELECT 1 FROM department_members dm_upl
          WHERE dm_upl.user_id = invoices.uploaded_by
            AND dm_upl.department_id = invoices.department_id
        )
      )
    )
  )
  OR
  -- NON-DRAFT invoices visibility
  (
    status <> 'draft'
    AND (
      uploaded_by = auth.uid()
      OR
      current_approver_id = auth.uid()
      OR
      -- Dyrektor sees non-draft invoices from their departments
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND (
          department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          OR
          EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.user_id = auth.uid()
              AND dm.department_id = invoices.department_id
          )
          OR
          EXISTS (
            SELECT 1 FROM invoice_departments id2
            WHERE id2.invoice_id = invoices.id
              AND id2.department_id IN (
                SELECT id FROM departments WHERE director_id = auth.uid()
              )
          )
        )
      )
      OR
      -- Kierownik sees non-draft invoices in their departments (excluding those uploaded by directors)
      (
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
      OR
      -- Specjalista sees non-draft invoices in their departments
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id2
          WHERE id2.invoice_id = invoices.id
            AND id2.department_id IN (
              SELECT department_id FROM department_members WHERE user_id = auth.uid()
            )
        )
      )
      OR
      -- Extra department access
      EXISTS (
        SELECT 1 FROM user_department_access uda
        WHERE uda.user_id = auth.uid()
          AND uda.department_id = invoices.department_id
          AND uda.access_type = ANY(ARRAY['view', 'workflow'])
      )
    )
  )
);
