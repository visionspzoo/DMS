/*
  # Fix draft invoice visibility for managers and directors

  ## Problem
  Managers (Kierownik) could not see draft invoices uploaded by their subordinate
  specialists (Specjalista) in the same department.
  
  Directors (Dyrektor) could not see draft invoices uploaded by managers (Kierownik)
  or specialists (Specjalista) in the departments they manage.

  ## Solution
  Drop and recreate the main SELECT policy with corrected visibility rules:

  ### Draft invoice visibility rules:
  - **Specjalista**: sees only their own drafts
  - **Kierownik**: sees their own drafts + drafts uploaded by Specjalista
    in the same department (matched by profiles.department_id)
  - **Dyrektor**: sees their own drafts + drafts uploaded by Kierownik or Specjalista
    in departments where they are the director (departments.director_id = their id)
  - **CEO / Admin**: see all invoices

  ## Notes
  - Uses correct Polish capitalized roles: Specjalista, Kierownik, Dyrektor, CEO
  - Relies on profiles.department_id for Specjalista/Kierownik placement
  - Relies on departments.director_id for Dyrektor scope
  - Non-draft invoices keep their existing broader visibility rules unchanged
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

  -- DRAFT invoices: hierarchical visibility
  OR (
    status = 'draft'
    AND (
      -- Own drafts always visible
      uploaded_by = auth.uid()
      OR current_approver_id = auth.uid()

      -- Kierownik sees drafts from Specjalista in the same department
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        AND (
          SELECT role FROM profiles WHERE id = invoices.uploaded_by
        ) = 'Specjalista'
        AND (
          SELECT department_id FROM profiles WHERE id = invoices.uploaded_by
        ) = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )

      -- Dyrektor sees drafts from Kierownik or Specjalista in their managed departments
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
        AND (
          -- Department where director is assigned via director_id
          department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          -- Also via invoice_departments cross-table
          OR EXISTS (
            SELECT 1 FROM invoice_departments id2
            JOIN departments d ON d.id = id2.department_id
            WHERE id2.invoice_id = invoices.id
              AND d.director_id = auth.uid()
          )
        )
        AND (
          SELECT role FROM profiles WHERE id = invoices.uploaded_by
        ) = ANY(ARRAY['Specjalista', 'Kierownik'])
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
            SELECT 1 FROM invoice_departments id2
            WHERE id2.invoice_id = invoices.id
              AND id2.department_id IN (
                SELECT id FROM departments WHERE director_id = auth.uid()
              )
          )
        )
      )

      -- Kierownik sees all non-draft invoices assigned to their department
      -- (excluding those uploaded by Dyrektor)
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id2
          LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
          WHERE id2.invoice_id = invoices.id
            AND id2.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND (uploader.role IS NULL OR uploader.role <> 'Dyrektor')
        )
      )

      -- Specjalista sees non-draft invoices in their department
      OR (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
        AND EXISTS (
          SELECT 1 FROM invoice_departments id2
          WHERE id2.invoice_id = invoices.id
            AND id2.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        )
      )

      -- Extra: user_department_access grants
      OR EXISTS (
        SELECT 1 FROM user_department_access uda
        WHERE uda.user_id = auth.uid()
          AND uda.department_id = invoices.department_id
          AND uda.access_type IN ('view', 'workflow')
      )
    )
  )
);
