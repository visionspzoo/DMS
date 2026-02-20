/*
  # Fix draft invoice visibility for Kierownik and Dyrektor

  ## Problem
  Kierownik and Dyrektor cannot see draft invoices uploaded by their subordinates.

  ## Root Cause
  The SELECT policy for draft invoices was too restrictive:
  - Kierownik: only saw drafts from 'Specjalista' uploaders, missing drafts from other Kierowniks
  - Dyrektor: complex department_members checks that could fail
  - Both relied on department_members join which may not always be populated correctly

  ## Fix
  Simplify draft visibility using departments table directly:
  - Kierownik: sees all drafts in their department (via departments.manager_id OR department_members)
    where uploader is NOT a Dyrektor (subordinate check)
  - Dyrektor: sees all drafts in their departments (via departments.director_id OR department_members)
    where uploader is NOT a Dyrektor (or is same person)

  This ensures the hierarchy is respected without over-complicating the checks.
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    -- Admins see everything
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEO sees everything
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'

    -- DRAFT invoices visibility
    OR (
      status = 'draft'
      AND (
        -- Own drafts
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()

        -- Kierownik sees drafts in their department (uploader must not be a Dyrektor)
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND (
            department_id IN (SELECT id FROM departments WHERE manager_id = auth.uid())
            OR EXISTS (
              SELECT 1 FROM department_members dm
              WHERE dm.user_id = auth.uid() AND dm.department_id = invoices.department_id
            )
          )
          AND (SELECT role FROM profiles WHERE id = invoices.uploaded_by) <> 'Dyrektor'
        )

        -- Dyrektor sees drafts in their departments (uploader must not be a Dyrektor, unless it's themselves)
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            department_id IN (SELECT id FROM departments WHERE director_id = auth.uid())
            OR EXISTS (
              SELECT 1 FROM department_members dm
              WHERE dm.user_id = auth.uid() AND dm.department_id = invoices.department_id
            )
          )
          AND (
            (SELECT role FROM profiles WHERE id = invoices.uploaded_by) <> 'Dyrektor'
            OR uploaded_by = auth.uid()
          )
        )
      )
    )

    -- NON-DRAFT invoices visibility
    OR (
      status <> 'draft'
      AND (
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()

        -- Dyrektor sees non-draft invoices in their departments
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            department_id IN (SELECT id FROM departments WHERE director_id = auth.uid())
            OR EXISTS (
              SELECT 1 FROM department_members dm
              WHERE dm.user_id = auth.uid() AND dm.department_id = invoices.department_id
            )
            OR EXISTS (
              SELECT 1 FROM invoice_departments id2
              WHERE id2.invoice_id = invoices.id
                AND id2.department_id IN (SELECT id FROM departments WHERE director_id = auth.uid())
            )
          )
        )

        -- Kierownik sees non-draft invoices in their department (not uploaded by Dyrektor)
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

        -- Specjalista sees non-draft invoices in their departments
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

        -- User department access grants
        OR EXISTS (
          SELECT 1 FROM user_department_access uda
          WHERE uda.user_id = auth.uid()
            AND uda.department_id = invoices.department_id
            AND uda.access_type = ANY(ARRAY['view', 'workflow'])
        )
      )
    )
  );
