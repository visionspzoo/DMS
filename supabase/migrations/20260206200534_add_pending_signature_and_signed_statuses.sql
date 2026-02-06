/*
  # Add pending_signature and signed statuses to contracts

  1. Changes
    - Add `pending_signature` and `signed` to contracts status CHECK constraint
    - Update CEO approval policy to allow setting `pending_signature`
    - Add policy for CEO to mark contracts as signed

  2. Security
    - CEO can transition contracts from pending_ceo to pending_signature
    - CEO can transition contracts from pending_signature to signed
    - Updated existing policies to accommodate new status values
*/

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;

ALTER TABLE contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature', 'signed', 'approved', 'rejected'));

DROP POLICY IF EXISTS "CEO can approve and sign contracts" ON contracts;

CREATE POLICY "CEO can approve and sign contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    status IN ('pending_ceo', 'pending_signature', 'approved')
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ceo')
  )
  WITH CHECK (
    status IN ('pending_signature', 'signed', 'rejected')
  );
