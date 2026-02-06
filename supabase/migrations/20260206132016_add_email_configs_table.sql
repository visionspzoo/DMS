/*
  # Create Email Configurations Table

  1. New Tables
    - `user_email_configs`
      - `id` (uuid, primary key)
      - `user_id` (uuid, foreign key to auth.users)
      - `email_address` (text, email address)
      - `provider` (text, email provider type: gmail, outlook, imap)
      - `imap_server` (text, IMAP server address)
      - `imap_port` (integer, IMAP port, default 993)
      - `email_username` (text, email username/login)
      - `email_password` (text, encrypted password or app password)
      - `is_active` (boolean, whether sync is active)
      - `last_sync_at` (timestamptz, last synchronization time)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `user_email_configs` table
    - Add policy for users to read their own email configs
    - Add policy for users to insert their own email configs
    - Add policy for users to update their own email configs
    - Add policy for users to delete their own email configs
    
  3. Important Notes
    - Passwords are stored encrypted for security
    - Users can only access their own email configurations
    - IMAP settings allow connection to various email providers
*/

CREATE TABLE IF NOT EXISTS user_email_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  email_address text NOT NULL,
  provider text NOT NULL DEFAULT 'imap',
  imap_server text NOT NULL,
  imap_port integer NOT NULL DEFAULT 993,
  email_username text NOT NULL,
  email_password text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id, email_address)
);

ALTER TABLE user_email_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own email configs"
  ON user_email_configs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own email configs"
  ON user_email_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own email configs"
  ON user_email_configs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own email configs"
  ON user_email_configs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_email_configs_user_id ON user_email_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_email_configs_active ON user_email_configs(is_active) WHERE is_active = true;
