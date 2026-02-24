/*
  # Add internal_comment column to invoices

  1. Changes
    - `invoices` table: add `internal_comment` (text, nullable) — stores an internal note visible only within the system
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'internal_comment'
  ) THEN
    ALTER TABLE invoices ADD COLUMN internal_comment text DEFAULT NULL;
  END IF;
END $$;
