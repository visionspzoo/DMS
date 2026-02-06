/*
  # Email Message Tracking System

  1. New Tables
    - `processed_email_messages`
      - `id` (uuid, primary key)
      - `email_config_id` (uuid, foreign key to user_email_configs)
      - `message_uid` (text, unique identifier from IMAP)
      - `message_id` (text, email Message-ID header)
      - `processed_at` (timestamptz, when the message was processed)
      - `attachment_count` (int, number of attachments processed)
      - `invoice_count` (int, number of invoices created)
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS on `processed_email_messages` table
    - Add policy for users to read their own processed messages
    - Add policy for service role to manage all records
  
  3. Purpose
    - Track which email messages have been processed to avoid duplicates
    - Store message UIDs to prevent re-processing same emails
    - Track statistics about processed messages
*/

-- Create processed_email_messages table
CREATE TABLE IF NOT EXISTS processed_email_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_config_id uuid NOT NULL REFERENCES user_email_configs(id) ON DELETE CASCADE,
  message_uid text NOT NULL,
  message_id text,
  processed_at timestamptz DEFAULT now(),
  attachment_count int DEFAULT 0,
  invoice_count int DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

-- Create unique index to prevent duplicate processing
CREATE UNIQUE INDEX IF NOT EXISTS processed_email_messages_config_uid_idx 
  ON processed_email_messages(email_config_id, message_uid);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS processed_email_messages_email_config_id_idx 
  ON processed_email_messages(email_config_id);

CREATE INDEX IF NOT EXISTS processed_email_messages_processed_at_idx 
  ON processed_email_messages(processed_at DESC);

-- Enable RLS
ALTER TABLE processed_email_messages ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own processed messages
CREATE POLICY "Users can view own processed messages"
  ON processed_email_messages
  FOR SELECT
  TO authenticated
  USING (
    email_config_id IN (
      SELECT id FROM user_email_configs WHERE user_id = auth.uid()
    )
  );

-- Policy: Service role can manage all records
CREATE POLICY "Service role can manage all processed messages"
  ON processed_email_messages
  FOR ALL
  TO service_role
  USING (true)
  WITH CHECK (true);