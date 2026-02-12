/*
  # Add department assignment tracking to KSEF invoices

  1. Changes
    - Add `assigned_to_department_at` column to track when invoice was assigned to department
    - Update existing records to set this timestamp where department is already assigned
  
  2. Purpose
    - Enable sorting by assignment date in KSEF invoices view
    - Track when invoices were assigned vs when they were imported
*/

-- Add assignment timestamp column
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'assigned_to_department_at'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN assigned_to_department_at timestamptz;
  END IF;
END $$;

-- Update existing records - set assignment time for already assigned invoices
UPDATE ksef_invoices
SET assigned_to_department_at = created_at
WHERE transferred_to_department_id IS NOT NULL
  AND assigned_to_department_at IS NULL;