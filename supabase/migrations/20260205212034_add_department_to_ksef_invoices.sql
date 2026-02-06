/*
  # Add department tracking to KSEF invoices
  
  1. Changes
    - Add `transferred_to_department_id` column to track which department the invoice was transferred to
  
  2. Purpose
    - Allows tracking which department received the KSEF invoice
    - Enables filtering by assigned/unassigned invoices per department
*/

-- Add column to track department assignment
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'transferred_to_department_id'
  ) THEN
    ALTER TABLE ksef_invoices 
    ADD COLUMN transferred_to_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for faster filtering
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_department ON ksef_invoices(transferred_to_department_id);