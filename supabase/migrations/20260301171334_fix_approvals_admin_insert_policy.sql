/*
  # Fix admin approval insert policy

  ## Problem
  The existing INSERT policy on the `approvals` table only allows a user to insert rows
  where `approver_id = auth.uid()`. Admin approval bypasses the normal workflow by
  inserting approval rows on behalf of other users (manager/director), which violates
  this constraint.

  ## Fix
  Add a separate INSERT policy that allows admin users to insert approvals for any
  approver_id. Admins are identified by `is_admin = true` in the profiles table.
*/

CREATE POLICY "Admins can insert approvals on behalf of others"
  ON approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );
