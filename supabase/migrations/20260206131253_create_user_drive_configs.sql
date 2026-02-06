/*
  # Create User Drive Configuration Table

  ## New Tables
  - `user_drive_configs`
    - `id` (uuid, primary key)
    - `user_id` (uuid, references profiles) - User who owns this configuration
    - `google_drive_folder_url` (text) - Google Drive folder URL for automatic invoice import
    - `google_drive_folder_id` (text) - Extracted folder ID from URL
    - `is_active` (boolean) - Whether automatic import is enabled
    - `last_sync_at` (timestamptz) - Last time the folder was synced
    - `created_at` (timestamptz)
    - `updated_at` (timestamptz)

  ## Security
  - Enable RLS
  - Users can only view and manage their own drive configurations
  - Admin users can view all configurations

  ## Important Notes
  - Each user can have only one drive configuration
  - The folder URL is parsed to extract the folder ID for API calls
  - Automatic sync can be enabled/disabled by the user
*/

-- Create user_drive_configs table
CREATE TABLE IF NOT EXISTS user_drive_configs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  google_drive_folder_url text NOT NULL,
  google_drive_folder_id text,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

-- Enable RLS
ALTER TABLE user_drive_configs ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own drive config"
  ON user_drive_configs
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all drive configs"
  ON user_drive_configs
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Users can insert own drive config"
  ON user_drive_configs
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own drive config"
  ON user_drive_configs
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own drive config"
  ON user_drive_configs
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to extract folder ID from Google Drive URL
CREATE OR REPLACE FUNCTION extract_drive_folder_id(url text)
RETURNS text AS $$
DECLARE
  folder_id text;
BEGIN
  -- Extract folder ID from various Google Drive URL formats
  -- Format 1: https://drive.google.com/drive/folders/FOLDER_ID
  -- Format 2: https://drive.google.com/drive/u/0/folders/FOLDER_ID
  folder_id := (regexp_match(url, 'folders/([a-zA-Z0-9_-]+)'))[1];
  
  RETURN folder_id;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- Trigger to auto-extract folder ID from URL
CREATE OR REPLACE FUNCTION update_drive_folder_id()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract folder ID from URL
  NEW.google_drive_folder_id := extract_drive_folder_id(NEW.google_drive_folder_url);
  
  -- Update timestamp
  NEW.updated_at := now();
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_extract_folder_id ON user_drive_configs;
CREATE TRIGGER auto_extract_folder_id
  BEFORE INSERT OR UPDATE ON user_drive_configs
  FOR EACH ROW
  EXECUTE FUNCTION update_drive_folder_id();

-- Create index for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_drive_configs_user_id ON user_drive_configs(user_id);
CREATE INDEX IF NOT EXISTS idx_user_drive_configs_is_active ON user_drive_configs(is_active);