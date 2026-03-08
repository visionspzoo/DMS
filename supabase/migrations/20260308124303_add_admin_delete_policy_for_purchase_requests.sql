/*
  # Add admin delete policy for purchase_requests

  Allows users with admin role to delete any purchase request.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_requests' AND policyname = 'Admins can delete any purchase request'
  ) THEN
    CREATE POLICY "Admins can delete any purchase request"
      ON purchase_requests FOR DELETE
      TO authenticated
      USING (
        EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role = 'admin'
        )
      );
  END IF;
END $$;
