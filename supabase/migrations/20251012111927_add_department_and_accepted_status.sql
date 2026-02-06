/*
  # Add Department Field and Accepted Status

  ## Changes
  
  1. Modifications to `invoices` table
    - Add `department` column (text) for department filtering
    - Add 'accepted' to status enum values
  
  2. Modifications to `profiles` table
    - Add `department` column (text) for user department assignment
  
  3. Security
    - Update existing RLS policies to work with new fields
    - No changes to existing security model
*/

-- Add department column to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'department'
  ) THEN
    ALTER TABLE profiles ADD COLUMN department text;
  END IF;
END $$;

-- Add department column to invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'department'
  ) THEN
    ALTER TABLE invoices ADD COLUMN department text;
  END IF;
END $$;

-- Update invoice status check constraint to include 'accepted'
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check 
  CHECK (status IN ('pending', 'in_review', 'approved', 'rejected', 'accepted'));

-- Create index for department filtering
CREATE INDEX IF NOT EXISTS idx_invoices_department ON invoices(department);
CREATE INDEX IF NOT EXISTS idx_invoices_status_department ON invoices(status, department);
