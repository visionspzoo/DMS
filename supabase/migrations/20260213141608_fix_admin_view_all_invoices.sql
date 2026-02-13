/*
  # Fix Admin Access to All Invoices
  
  ## Problem
  Current RLS policies restrict admins to only see invoices from:
  - Their own department
  - Departments they have explicit access grants for
  
  This prevents admins from having full system visibility.
  
  ## Solution
  Update RLS policies to give admins (is_admin = true) access to ALL invoices in the system:
  - All invoices in the `invoices` table
  - All KSEF invoices in the `ksef_invoices` table
  
  ## Changes
  1. Drop and recreate "Admins can view invoices from accessible departments" policy
     - New policy: Admins see ALL invoices, not just from accessible departments
  
  2. Update "View assigned KSEF invoices based on role" policy
     - Simplify admin check to show ALL KSEF invoices (not just assigned ones)
  
  3. Add new policy for unassigned KSEF invoices visibility for admins
  
  ## Security
  - Only users with is_admin = true get full access
  - Other roles maintain their existing restrictions
  - CEO role maintains full access (unchanged)
*/

-- ============================================
-- FIX INVOICES TABLE POLICIES
-- ============================================

-- Drop the restrictive admin policy
DROP POLICY IF EXISTS "Admins can view invoices from accessible departments" ON invoices;

-- Create new policy: Admins can view ALL invoices
CREATE POLICY "Admins can view all invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- ============================================
-- FIX KSEF_INVOICES TABLE POLICIES
-- ============================================

-- Drop existing policies for assigned KSEF invoices
DROP POLICY IF EXISTS "View assigned KSEF invoices based on role" ON ksef_invoices;

-- Recreate with simplified admin access
CREATE POLICY "View assigned KSEF invoices based on role"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    -- Invoice must be assigned (has department or has been transferred)
    (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
    AND (
      -- Admins can see ALL KSEF invoices (assigned or not)
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

-- Also update the unassigned KSEF invoices policy to include admins
DROP POLICY IF EXISTS "View unassigned KSEF invoices" ON ksef_invoices;

CREATE POLICY "View unassigned KSEF invoices"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    -- Invoice is NOT assigned yet
    transferred_to_department_id IS NULL
    AND transferred_to_invoice_id IS NULL
    AND (
      -- Admins can see all unassigned KSEF invoices
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      -- User who fetched it can see it
      fetched_by = auth.uid()
      OR
      -- CEO can see all
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'CEO'
      )
    )
  );

-- Add comments for clarity
COMMENT ON POLICY "Admins can view all invoices" ON invoices IS
'Administrators (is_admin = true) have full visibility to all invoices in the system';

COMMENT ON POLICY "View assigned KSEF invoices based on role" ON ksef_invoices IS
'Allows users to view assigned KSEF invoices based on their role:
- Admin: ALL KSEF invoices (assigned or not)
- CEO: all assigned invoices
- Dyrektor: assigned invoices from department and subdepartments
- Kierownik: assigned invoices from their department
- Specjalista: only invoices they fetched';

COMMENT ON POLICY "View unassigned KSEF invoices" ON ksef_invoices IS
'Allows admins, CEO, and the fetcher to see unassigned KSEF invoices';
