/*
  # Add source column to invoices table

  1. Modified Tables
    - `invoices`
      - `source` (text) - tracks origin of the invoice: 'manual', 'email', 'google_drive', 'ksef'
      - Default value: 'manual'

  2. Notes
    - Existing invoices default to 'manual' since we can't retroactively determine their origin
    - Constraint ensures only valid source values are stored
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'source'
  ) THEN
    ALTER TABLE invoices ADD COLUMN source text DEFAULT 'manual';
    ALTER TABLE invoices ADD CONSTRAINT invoices_source_check
      CHECK (source IN ('manual', 'email', 'google_drive', 'ksef'));
  END IF;
END $$;
