/*
  # Fix admin delete policy for purchase_requests

  The existing DELETE policy used `role = 'admin'` (text comparison) while
  all other admin policies use `is_admin = true`. This caused admins to be
  unable to delete purchase requests. Recreate the policy with the correct check.
*/

DROP POLICY IF EXISTS "Admins can delete any purchase request" ON purchase_requests;

CREATE POLICY "Admins can delete any purchase request"
  ON purchase_requests FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );
