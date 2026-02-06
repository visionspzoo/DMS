/*
  # Update RLS to Allow Editing and Deleting Draft Invoices

  1. Changes
    - Update DELETE policy to allow users to delete their own draft invoices
    - Update UPDATE policy to allow users to update their own draft invoices
    
  2. Updated Policy Logic
    - Users can delete their own invoices if status is 'draft'
    - Users can update their own invoices if status is 'draft'
    - Admins can still delete and update any invoice
    
  3. Security
    - Users can only modify their own draft invoices
    - Once submitted (status changes from draft), users lose edit/delete privileges
    - Admin override remains for all invoices
*/

-- Drop existing policies that are too restrictive
DROP POLICY IF EXISTS "Uploader can delete own pending invoices" ON invoices;
DROP POLICY IF EXISTS "Uploader can update own pending invoices" ON invoices;

-- Create new DELETE policy for draft invoices
CREATE POLICY "Uploader can delete own draft invoices"
  ON invoices
  FOR DELETE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND status = 'draft'
  );

-- Create new UPDATE policy for draft invoices
CREATE POLICY "Uploader can update own draft invoices"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    AND status = 'draft'
  )
  WITH CHECK (
    uploaded_by = auth.uid()
  );
