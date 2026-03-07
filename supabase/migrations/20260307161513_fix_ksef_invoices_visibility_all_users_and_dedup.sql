/*
  # Fix KSEF Invoices: All Users See Unassigned + Deduplication Constraint

  ## Problem 1: Unassigned KSEF invoices not visible to all users
  - Current SELECT policy requires can_access_ksef_config=true OR role Dyrektor/Kierownik
  - Users with role 'Specjalista' without the flag (e.g. noreply@auraherbals.pl) see empty list
  - Fix: All authenticated users can see unassigned (not yet assigned) KSEF invoices

  ## Problem 2: No DB-level deduplication guard
  - Code already checks for duplicates before insert, but no DB constraint exists
  - Add UNIQUE constraint on ksef_reference_number so duplicate inserts are safely ignored

  ## Changes
  1. Drop old SELECT policy on ksef_invoices
  2. Create new SELECT policy: all authenticated users see unassigned invoices;
     assigned invoices follow department/role rules
  3. Add UNIQUE constraint on ksef_reference_number (if not exists)

  ## Security
  - All authenticated company users can see invoices pending assignment
  - Assigned invoices remain restricted to relevant departments/roles
  - Admins and CEO retain full visibility
*/

-- ============================================================================
-- 1. Fix SELECT visibility: unassigned invoices visible to ALL authenticated users
-- ============================================================================

DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;

CREATE POLICY "Users can view KSEF invoices based on role and department"
  ON ksef_invoices
  FOR SELECT
  TO authenticated
  USING (
    -- Admins see everything
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEO sees everything
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Unassigned invoices: visible to ALL authenticated users (for assignment workflow)
    (
      transferred_to_department_id IS NULL
      AND transferred_to_invoice_id IS NULL
      AND ignored_at IS NULL
    )
    OR
    -- Unassigned but ignored: visible to admins/CEO only (handled above)
    -- Assigned invoices: visible based on department/role
    (
      (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
      AND (
        -- Users with KSEF config access
        (SELECT can_access_ksef_config FROM profiles WHERE id = auth.uid()) = true
        OR
        -- Director sees invoices assigned to their departments
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            transferred_to_department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            OR transferred_to_department_id IN (
              WITH RECURSIVE dept_tree AS (
                SELECT d.id FROM departments d
                WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                UNION ALL
                SELECT d.id FROM departments d
                JOIN dept_tree dt ON d.parent_department_id = dt.id
              )
              SELECT id FROM dept_tree
            )
            OR fetched_by = auth.uid()
          )
        )
        OR
        -- Manager sees invoices assigned to their department
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND (
            transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            OR fetched_by = auth.uid()
          )
        )
        OR
        -- Specialist sees invoices assigned to their department
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
          AND (
            transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            OR fetched_by = auth.uid()
          )
        )
      )
    )
    OR
    -- Ignored invoices: visible to users with KSEF config access, directors, managers, CEO, admins
    (
      ignored_at IS NOT NULL
      AND (
        (SELECT can_access_ksef_config FROM profiles WHERE id = auth.uid()) = true
        OR (SELECT role FROM profiles WHERE id = auth.uid()) IN ('Dyrektor', 'Kierownik')
      )
    )
  );

-- ============================================================================
-- 2. Add UNIQUE constraint on ksef_reference_number for deduplication
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE table_name = 'ksef_invoices'
    AND constraint_name = 'ksef_invoices_ksef_reference_number_key'
    AND constraint_type = 'UNIQUE'
  ) THEN
    ALTER TABLE ksef_invoices
      ADD CONSTRAINT ksef_invoices_ksef_reference_number_key
      UNIQUE (ksef_reference_number);
  END IF;
END $$;
