/*
  # Fix KSEF Invoices Visibility for Unassigned Invoices

  1. Changes
    - Drop the existing restrictive SELECT policy on ksef_invoices
    - Create a new policy that allows:
      - All authenticated users to see unassigned invoices (transferred_to_department_id IS NULL)
      - Admins and CEOs to see all invoices
      - Directors to see invoices assigned to their department hierarchy
      - Managers to see invoices assigned to their department
      - Specialists to see invoices they fetched

  2. Security
    - Unassigned invoices are visible to all authenticated users for processing
    - Assigned invoices remain restricted based on department access
*/

DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;

CREATE POLICY "Users can view KSEF invoices based on role and department"
  ON ksef_invoices
  FOR SELECT
  TO authenticated
  USING (
    -- Unassigned invoices are visible to all authenticated users
    transferred_to_department_id IS NULL
    OR
    -- Admins can see all invoices
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEOs can see all invoices
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Directors can see invoices in their department hierarchy
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND transferred_to_department_id IN (
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
    OR
    -- Managers can see invoices in their department
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
    )
    OR
    -- Specialists can see invoices they fetched
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND fetched_by = auth.uid()
    )
  );
