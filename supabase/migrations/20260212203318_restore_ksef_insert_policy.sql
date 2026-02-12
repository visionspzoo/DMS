/*
  # Restore KSEF Invoices INSERT Policy
  
  ## Problem
  Previous migrations removed the INSERT policy for ksef_invoices table.
  This prevents users from saving KSEF invoices fetched from the external API.
  Users can fetch invoices but they cannot be saved to the database.
  
  ## Solution
  Restore the INSERT policy to allow authenticated users to insert KSEF invoices
  when they fetch them from the API.
  
  ## Changes
  1. Drop any existing INSERT policies to avoid conflicts
  2. Create new INSERT policy that allows:
     - Authenticated users to insert invoices they fetch (auth.uid() = fetched_by)
     - Or users with KSEF config access
     - Or Admins
     - Or Directors
     - Or Managers
     - Or CEO
  
  ## Security
  - Maintains RLS protection
  - Only authorized users can insert invoices
  - The fetched_by field must match the authenticated user OR user has appropriate role
*/

-- Drop any existing INSERT policies to start fresh
DROP POLICY IF EXISTS "Authenticated users can insert KSEF invoices" ON ksef_invoices;
DROP POLICY IF EXISTS "Users can insert KSEF invoices" ON ksef_invoices;
DROP POLICY IF EXISTS "Allow insert for KSEF invoice fetching" ON ksef_invoices;

-- Create comprehensive INSERT policy
CREATE POLICY "Authenticated users can insert KSEF invoices"
  ON ksef_invoices FOR INSERT
  TO authenticated
  WITH CHECK (
    -- User must be the one fetching (fetched_by = auth.uid())
    (auth.uid() = fetched_by)
    OR
    -- OR user is an Admin
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- OR user has KSEF config access
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.can_access_ksef_config = true
    )
    OR
    -- OR user is a Director
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
    OR
    -- OR user is a Manager
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Kierownik'
    )
    OR
    -- OR user is CEO
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
  );

-- Add helpful comment
COMMENT ON POLICY "Authenticated users can insert KSEF invoices" ON ksef_invoices IS
'Allows authenticated users to insert KSEF invoices when fetching from API.
The user must be the one fetching (fetched_by) or have appropriate role/permissions.';