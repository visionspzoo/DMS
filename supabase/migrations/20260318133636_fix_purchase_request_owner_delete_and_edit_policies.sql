/*
  # Fix Purchase Request Owner Permissions

  ## Changes
  1. Add DELETE policy for request owner (status pending or rejected only)
  2. Add UPDATE policy for request owner (status pending or rejected only)

  These policies allow users to:
  - Withdraw (delete) their own pending or rejected purchase requests
  - Edit their own pending or rejected purchase requests

  ## Security
  - Both policies check ownership via user_id = auth.uid()
  - Both policies restrict to safe statuses (pending, rejected)
  - Approved and paid requests cannot be modified or deleted by owner
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_requests' AND policyname = 'Owner can delete own pending or rejected request'
  ) THEN
    CREATE POLICY "Owner can delete own pending or rejected request"
      ON purchase_requests FOR DELETE
      TO authenticated
      USING (
        user_id = auth.uid()
        AND status IN ('pending', 'rejected')
      );
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_requests' AND policyname = 'Owner can update own pending or rejected request'
  ) THEN
    CREATE POLICY "Owner can update own pending or rejected request"
      ON purchase_requests FOR UPDATE
      TO authenticated
      USING (
        user_id = auth.uid()
        AND status IN ('pending', 'rejected')
      )
      WITH CHECK (
        user_id = auth.uid()
        AND status IN ('pending', 'rejected')
      );
  END IF;
END $$;
