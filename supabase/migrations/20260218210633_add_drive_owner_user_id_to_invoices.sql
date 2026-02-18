/*
  # Add drive_owner_user_id to invoices table

  ## Summary
  Adds a `drive_owner_user_id` column to `invoices` to track which user's
  Google Drive credentials should be used when deleting the source file.

  ## Changes
  - `invoices.drive_owner_user_id` (uuid, nullable, FK to auth.users)
    Stores the user ID of the person who originally synced the invoice from
    their Google Drive. This may differ from `uploaded_by` when folder mappings
    reassign ownership to a department manager/director. Used by the
    delete-from-google-drive edge function to use the correct OAuth credentials.

  ## Notes
  - Nullable so existing rows are unaffected
  - No cascade delete - if the sync user is removed, the column stays null
*/

ALTER TABLE invoices
ADD COLUMN IF NOT EXISTS drive_owner_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_invoices_drive_owner_user_id
  ON invoices(drive_owner_user_id);

COMMENT ON COLUMN invoices.drive_owner_user_id IS
  'User whose Google Drive credentials own this file (syncing user, may differ from uploaded_by)';
