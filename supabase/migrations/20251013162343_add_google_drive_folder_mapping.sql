/*
  # Add Google Drive folder mapping to departments

  1. Changes
    - Add `google_drive_unpaid_folder_id` column to departments table
    - Add `google_drive_paid_folder_id` column to departments table
    - These columns will store Google Drive folder IDs for organizing invoices

  2. Notes
    - Unpaid folder: stores accepted but unpaid invoices
    - Paid folder: stores invoices marked as paid
    - Both fields are optional (can be null if not configured)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'google_drive_unpaid_folder_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN google_drive_unpaid_folder_id text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'google_drive_paid_folder_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN google_drive_paid_folder_id text;
  END IF;
END $$;

COMMENT ON COLUMN departments.google_drive_unpaid_folder_id IS 'Google Drive folder ID dla faktur nieopłaconych';
COMMENT ON COLUMN departments.google_drive_paid_folder_id IS 'Google Drive folder ID dla faktur opłaconych';