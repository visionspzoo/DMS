/*
  # Add file hash column for duplicate invoice detection

  1. Modified Tables
    - `invoices`
      - `file_hash` (text, nullable) - SHA-256 hash of the uploaded file content
      - Unique index on (file_hash, uploaded_by) to prevent same user uploading same file twice

  2. Important Notes
    - Existing invoices will have NULL file_hash (they were uploaded before this feature)
    - The hash is computed client-side using Web Crypto API before upload
    - Duplicates are detected per-user (different users can upload the same file)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'file_hash'
  ) THEN
    ALTER TABLE invoices ADD COLUMN file_hash text;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_invoices_file_hash_per_user
  ON invoices(file_hash, uploaded_by)
  WHERE file_hash IS NOT NULL;
