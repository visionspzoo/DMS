/*
  # Fix KSEF Invoices Department Visibility

  ## Problem
  - KSEF invoices have RLS policy `USING (true)` that allows all authenticated users to see all KSEF invoices
  - When a KSEF invoice is transferred to a department, only users from that department should see it
  - This is inconsistent with normal invoices visibility rules

  ## Changes
  - Update RLS policy for KSEF invoices to respect department visibility
  - Users should only see KSEF invoices that:
    - They fetched themselves (fetched_by = auth.uid())
    - OR are transferred to their department (matching role-based rules)
  
  ## New Logic
  - CEO: Sees all KSEF invoices
  - Dyrektor: Sees KSEF invoices transferred to their department tree
  - Kierownik: Sees KSEF invoices transferred to their department
  - Specjalista: Sees own fetched invoices AND invoices transferred to their department
  
  ## Security
  - Maintains role-based hierarchical access
  - Users only see KSEF invoices relevant to their department
*/

DROP POLICY IF EXISTS "Authenticated users can view KSEF invoices" ON ksef_invoices;

CREATE POLICY "Users can view KSEF invoices based on role and department"
  ON ksef_invoices
  FOR SELECT
  TO authenticated
  USING (
    -- User's own fetched invoices
    (fetched_by = auth.uid())
    OR
    -- Invoices visible based on role and department assignment
    (
      -- CEO can see all KSEF invoices
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
      OR
      -- Dyrektor can see invoices transferred to their department tree
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
      -- Kierownik can see invoices transferred to their department
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
        AND transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
      OR
      -- Specjalista can see invoices transferred to their department
      (
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
        AND transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
    )
  );
