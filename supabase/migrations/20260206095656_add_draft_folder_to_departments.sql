/*
  # Add Google Drive draft folder to departments

  1. Changes
    - Add `google_drive_draft_folder_id` column to departments table
    - This column will store Google Drive folder ID for draft/unclassified invoices
  
  2. Notes
    - Draft folder: stores invoices that are not yet classified as paid or unpaid
    - This is especially useful for invoices fetched from KSEF that need review
    - Field is optional (can be null if not configured)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'google_drive_draft_folder_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN google_drive_draft_folder_id text;
  END IF;
END $$;

COMMENT ON COLUMN departments.google_drive_draft_folder_id IS 'Google Drive folder ID dla faktur roboczych (niesklasyfikowanych)';