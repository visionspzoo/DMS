/*
  # Create contract summaries table

  1. New Tables
    - `contract_summaries`
      - `id` (uuid, primary key)
      - `contract_id` (uuid, foreign key to contracts)
      - `brief` (text) - Short summary of the contract
      - `details` (text) - Detailed information about the contract
      - `key_points` (text) - Important points to pay attention to
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `contract_summaries` table
    - Add policies for users to view summaries of contracts they have access to
    - Add policies for users to create summaries for contracts they have access to
    - Add policies for users to update summaries for contracts they have access to

  3. Indexes
    - Add unique index on `contract_id` to ensure one summary per contract
    - Add index on `contract_id` for faster lookups
*/

CREATE TABLE IF NOT EXISTS contract_summaries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  brief text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  key_points text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS contract_summaries_contract_id_idx ON contract_summaries(contract_id);

ALTER TABLE contract_summaries ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view summaries of accessible contracts"
  ON contract_summaries
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_summaries.contract_id
      AND (
        contracts.uploaded_by = auth.uid()
        OR contracts.current_approver = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('CEO', 'Dyrektor', 'Kierownik')
        )
      )
    )
  );

CREATE POLICY "Users can create summaries for accessible contracts"
  ON contract_summaries
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_summaries.contract_id
      AND (
        contracts.uploaded_by = auth.uid()
        OR contracts.current_approver = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('CEO', 'Dyrektor', 'Kierownik')
        )
      )
    )
  );

CREATE POLICY "Users can update summaries for accessible contracts"
  ON contract_summaries
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_summaries.contract_id
      AND (
        contracts.uploaded_by = auth.uid()
        OR contracts.current_approver = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('CEO', 'Dyrektor', 'Kierownik')
        )
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_summaries.contract_id
      AND (
        contracts.uploaded_by = auth.uid()
        OR contracts.current_approver = auth.uid()
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid()
          AND profiles.role IN ('CEO', 'Dyrektor', 'Kierownik')
        )
      )
    )
  );

CREATE OR REPLACE FUNCTION update_contract_summary_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER update_contract_summary_timestamp
  BEFORE UPDATE ON contract_summaries
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_summary_timestamp();
