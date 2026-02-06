/*
  # Add specialist role and forward flow to contracts

  1. Changes
    - Add `pending_specialist` status to contracts
    - Update approval system to support specialist role
    - Add policies for specialist to manage contracts

  2. Security
    - Specialists can view and approve contracts assigned to them
    - Each role can forward contracts to the next level
*/

ALTER TABLE contracts DROP CONSTRAINT IF EXISTS contracts_status_check;

ALTER TABLE contracts ADD CONSTRAINT contracts_status_check
  CHECK (status IN ('draft', 'pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature', 'signed', 'approved', 'rejected'));

DROP POLICY IF EXISTS "Specialists can view assigned contracts" ON contracts;

CREATE POLICY "Specialists can view assigned contracts"
  ON contracts
  FOR SELECT
  TO authenticated
  USING (
    current_approver = auth.uid()
    OR uploaded_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM profiles 
      WHERE id = auth.uid() 
      AND role IN ('manager', 'director', 'ceo')
    )
  );

DROP POLICY IF EXISTS "Specialists can update assigned contracts" ON contracts;

CREATE POLICY "Specialists can update assigned contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    current_approver = auth.uid()
    AND status IN ('pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature')
  )
  WITH CHECK (
    status IN ('pending_specialist', 'pending_manager', 'pending_director', 'pending_ceo', 'pending_signature', 'signed', 'rejected')
  );
