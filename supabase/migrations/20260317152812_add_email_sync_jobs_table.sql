/*
  # Add email_sync_jobs table for chunked background email sync

  1. New Tables
    - `email_sync_jobs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references profiles)
      - `email_config_id` (uuid, references user_email_configs)
      - `status` (text): 'pending' | 'running' | 'completed' | 'failed'
      - `page_token` (text, nullable): Gmail nextPageToken for resuming pagination
      - `messages_found` (int): total messages discovered so far
      - `messages_processed` (int): messages processed so far
      - `invoices_synced` (int): invoices successfully created
      - `chunk_size` (int): how many messages to process per chunk (default 20)
      - `query` (text): Gmail query string used for this job
      - `force_reimport` (boolean)
      - `date_from` (date, nullable)
      - `date_to` (date, nullable)
      - `started_at` (timestamptz)
      - `last_chunk_at` (timestamptz, nullable): when the last chunk was processed
      - `completed_at` (timestamptz, nullable)
      - `error_message` (text, nullable)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS
    - Users can read/update their own jobs
    - Service role has full access

  3. Notes
    - This enables resumable, chunked email sync
    - Cron job picks up jobs with status='pending' or stalled 'running' jobs
    - Each chunk processes CHUNK_SIZE messages then saves progress
*/

CREATE TABLE IF NOT EXISTS email_sync_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_config_id uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  page_token text,
  messages_found int NOT NULL DEFAULT 0,
  messages_processed int NOT NULL DEFAULT 0,
  invoices_synced int NOT NULL DEFAULT 0,
  chunk_size int NOT NULL DEFAULT 20,
  query text NOT NULL DEFAULT '',
  force_reimport boolean NOT NULL DEFAULT false,
  date_from date,
  date_to date,
  started_at timestamptz DEFAULT now(),
  last_chunk_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE email_sync_jobs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own sync jobs"
  ON email_sync_jobs FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own sync jobs"
  ON email_sync_jobs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own sync jobs"
  ON email_sync_jobs FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_user_status ON email_sync_jobs(user_id, status);
CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_config ON email_sync_jobs(email_config_id);
CREATE INDEX IF NOT EXISTS idx_email_sync_jobs_status ON email_sync_jobs(status);
