/*
  # Create contract PDF annotations table

  1. New Tables
    - `contract_pdf_annotations`
      - `id` (uuid, primary key)
      - `contract_id` (uuid, references contracts)
      - `user_id` (uuid, references auth.users)
      - `x_percent` (numeric, pin X position as % of container width)
      - `y_percent` (numeric, pin Y position as % of container height)
      - `comment` (text, annotation content)
      - `color` (text, pin color identifier)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `contract_pdf_annotations`
    - Authenticated users can read all annotations for contracts they can access
    - Users can insert/delete only their own annotations

  3. Indexes
    - Index on (contract_id, created_at) for fast lookups
*/

CREATE TABLE IF NOT EXISTS contract_pdf_annotations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  x_percent numeric NOT NULL CHECK (x_percent >= 0 AND x_percent <= 100),
  y_percent numeric NOT NULL CHECK (y_percent >= 0 AND y_percent <= 100),
  comment text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'blue',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contract_pdf_annotations ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_contract_pdf_annotations_lookup
  ON contract_pdf_annotations (contract_id, created_at);

CREATE POLICY "Authenticated users can read contract pdf annotations"
  ON contract_pdf_annotations
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contracts c
      WHERE c.id = contract_pdf_annotations.contract_id
    )
  );

CREATE POLICY "Users can insert own contract pdf annotations"
  ON contract_pdf_annotations
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own contract pdf annotations"
  ON contract_pdf_annotations
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
