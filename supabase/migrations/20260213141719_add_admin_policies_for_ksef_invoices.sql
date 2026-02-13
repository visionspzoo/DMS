/*
  # Add Admin Policies for KSEF Invoices
  
  ## Problem
  Administrators cannot update or delete KSEF invoices. Current policies only allow
  the user who fetched the invoice (fetched_by) to modify it.
  
  ## Solution
  Add UPDATE and DELETE policies that give administrators full access to all KSEF invoices.
  
  ## Changes
  1. Add "Admins can update any KSEF invoice" policy
  2. Add "Admins can delete any KSEF invoice" policy
  
  ## Security
  - Only users with is_admin = true get full access
  - Existing fetcher policies remain unchanged for regular users
*/

-- Policy: Admins can update any KSEF invoice
CREATE POLICY "Admins can update any KSEF invoice"
  ON ksef_invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Policy: Admins can delete any KSEF invoice
CREATE POLICY "Admins can delete any KSEF invoice"
  ON ksef_invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Add comments for clarity
COMMENT ON POLICY "Admins can update any KSEF invoice" ON ksef_invoices IS
'Administrators (is_admin = true) can update any KSEF invoice regardless of who fetched it';

COMMENT ON POLICY "Admins can delete any KSEF invoice" ON ksef_invoices IS
'Administrators (is_admin = true) can delete any KSEF invoice regardless of who fetched it';
