/*
  # Add thread_id and imported filenames tracking to processed email messages

  1. Changes
    - Add `thread_id` column to `processed_email_messages` - stores Gmail thread ID
    - Add `imported_filenames` column - array of filenames already imported from this thread
    - Create new table `processed_email_thread_files` for per-thread per-filename dedup
      - Unique constraint on (email_config_id, thread_id, filename) prevents importing
        the same PDF filename from the same email thread twice (handles forward/reply scenarios)

  2. Security
    - RLS enabled on new table
    - Authenticated users can only see their own records
*/

ALTER TABLE processed_email_messages
  ADD COLUMN IF NOT EXISTS thread_id text;

CREATE TABLE IF NOT EXISTS processed_email_thread_files (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_config_id uuid NOT NULL REFERENCES user_email_configs(id) ON DELETE CASCADE,
  thread_id text NOT NULL,
  filename text NOT NULL,
  message_id text NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_thread_file_unique
  ON processed_email_thread_files (email_config_id, thread_id, filename);

CREATE INDEX IF NOT EXISTS idx_thread_file_lookup
  ON processed_email_thread_files (email_config_id, thread_id);

ALTER TABLE processed_email_thread_files ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can read own thread files"
  ON processed_email_thread_files
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM user_email_configs c
      WHERE c.id = email_config_id
      AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Users can insert own thread files"
  ON processed_email_thread_files
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM user_email_configs c
      WHERE c.id = email_config_id
      AND c.user_id = auth.uid()
    )
  );

CREATE POLICY "Service role full access to thread files"
  ON processed_email_thread_files
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);
