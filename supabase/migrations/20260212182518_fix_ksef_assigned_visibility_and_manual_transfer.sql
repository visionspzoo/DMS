/*
  # Fix KSEF Assigned Invoices Visibility and Enable Manual Transfer
  
  ## Problem Identified
  1. Auto-assigned KSEF invoices (`transferred_to_department_id` is set) are not automatically transferred to `invoices` table
  2. Current RLS policy "View assigned KSEF invoices" only allows Admin, Directors, and CEO to see assigned invoices
  3. Managers (Kierownicy) and Specialists (Specjaliści) cannot see assigned KSEF invoices in their department
  4. Users see KSEF invoices in "Faktury KSEF" but after transfer, no PDF appears in "Moje Faktury" because invoices were never transferred
  
  ## Solution
  1. Update RLS policy to allow Managers and Specialists to see assigned KSEF invoices from their department
  2. This will enable them to manually transfer auto-assigned invoices using the existing transfer button
  
  ## Changes
  1. Drop existing "View assigned KSEF invoices" policy
  2. Create new policy that includes:
     - Admin: all assigned invoices
     - CEO: all assigned invoices
     - Directors: assigned invoices from their department and subdepartments
     - Managers: assigned invoices from their department
     - Specialists: assigned invoices they fetched
  
  ## Security
  - Maintains proper access control based on roles
  - Specialists can only see invoices they personally fetched
  - Managers can see all assigned invoices in their department
*/

-- Drop the overly restrictive policy
DROP POLICY IF EXISTS "View assigned KSEF invoices" ON ksef_invoices;

-- Create new comprehensive policy for assigned invoices
CREATE POLICY "View assigned KSEF invoices based on role"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    -- Invoice must be assigned (has department or has been transferred)
    (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
    AND (
      -- Admins can see all assigned invoices
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      -- CEO can see all assigned invoices
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'CEO'
      )
      OR
      -- Directors can see assigned invoices from their department and subdepartments
      (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'Dyrektor'
        )
        AND (
          transferred_to_department_id IN (
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
      -- Managers can see assigned invoices from their department
      (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'Kierownik'
        )
        AND (
          transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          OR fetched_by = auth.uid()
        )
      )
      OR
      -- Specialists can see assigned invoices they fetched
      (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'Specjalista'
        )
        AND fetched_by = auth.uid()
      )
    )
  );

-- Add helpful comment
COMMENT ON POLICY "View assigned KSEF invoices based on role" ON ksef_invoices IS
'Allows users to view assigned KSEF invoices based on their role:
- Admin: all assigned invoices
- CEO: all assigned invoices
- Dyrektor: assigned invoices from department and subdepartments
- Kierownik: assigned invoices from their department
- Specjalista: only invoices they fetched';
