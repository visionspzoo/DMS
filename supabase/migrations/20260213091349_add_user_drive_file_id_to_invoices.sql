/*
  # Add user_drive_file_id to invoices table

  1. Changes
    - Add `user_drive_file_id` column to `invoices` table
      - Stores the Google Drive file ID from user's personal folder
      - Used to delete the file from user's personal folder when invoice is deleted
    - This allows tracking both the department folder file (google_drive_id) 
      and the original user folder file (user_drive_file_id)

  2. Important Notes
    - When deleting a draft invoice, both files should be deleted:
      - File in department draft folder (google_drive_id)
      - Original file in user's personal folder (user_drive_file_id)
*/

-- Add user_drive_file_id column to invoices
ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS user_drive_file_id text;

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_invoices_user_drive_file_id
  ON invoices(user_drive_file_id);

-- Add comment explaining the column
COMMENT ON COLUMN invoices.user_drive_file_id IS 'Google Drive file ID from user personal folder (for deletion purposes)';
