/*
  # Allow Users to Transfer Invoices to Other Departments

  1. Changes
    - Update the "Users can accept invoices assigned to them" policy
    - Allow users to transfer invoices they uploaded to other departments
    - Allow users to transfer invoices assigned to them (current_approver_id)

  2. Security
    - Users can transfer their own invoices (uploaded_by)
    - Users can transfer invoices assigned to them (current_approver_id)
    - CEO and Admins retain full control

  3. Notes
    - This enables specialists, managers, and directors to transfer invoices between departments
    - The transfer action updates department_id and current_approver_id fields
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can accept invoices assigned to them" ON invoices;

-- Create updated policy that allows transferring invoices
CREATE POLICY "Users can accept invoices assigned to them"
ON invoices
FOR UPDATE
TO authenticated
USING (
  -- User uploaded the invoice (can transfer own invoices)
  uploaded_by = auth.uid()
  OR
  -- Invoice is assigned to user (can accept/transfer assigned invoices)
  current_approver_id = auth.uid()
  OR
  -- CEO has full access
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('CEO')
  OR
  -- Admin has full access
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
)
WITH CHECK (
  -- Same conditions for WITH CHECK
  uploaded_by = auth.uid()
  OR
  current_approver_id = auth.uid()
  OR
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('CEO')
  OR
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
);

-- Comment
COMMENT ON POLICY "Users can accept invoices assigned to them" ON invoices IS
'Users can update invoices they uploaded or that are assigned to them. CEO and Admins have full access.';