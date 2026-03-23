/*
  # Add file_size to processed_email_thread_files

  ## Changes
  - Adds `file_size` (bigint, nullable) column to `processed_email_thread_files`
  - This enables deduplication by filename + file size before downloading the attachment,
    avoiding unnecessary API calls and OCR processing for already-processed files

  ## Notes
  - Column is nullable to remain backwards-compatible with existing records (they will have NULL)
  - New inserts will populate this column with the actual attachment size in bytes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'processed_email_thread_files' AND column_name = 'file_size'
  ) THEN
    ALTER TABLE processed_email_thread_files ADD COLUMN file_size bigint;
  END IF;
END $$;
