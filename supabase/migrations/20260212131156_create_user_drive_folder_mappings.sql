/*
  # Create User Drive Folder to Department Mappings

  ## Overview
  This migration creates a system that allows users to configure multiple Google Drive folders
  and map each folder to a specific department. Invoices imported from a folder will automatically
  be assigned to the mapped department.

  ## New Tables
  - `user_drive_folder_mappings`
    - `id` (uuid, primary key) - Unique identifier
    - `user_id` (uuid, references profiles) - User who owns this folder mapping
    - `folder_name` (text) - User-friendly name for the folder
    - `google_drive_folder_url` (text) - Google Drive folder URL
    - `google_drive_folder_id` (text) - Extracted folder ID for API calls
    - `department_id` (uuid, references departments) - Department to assign invoices to
    - `is_active` (boolean) - Whether automatic sync is enabled for this folder
    - `last_sync_at` (timestamptz) - Last time this folder was synced
    - `created_at` (timestamptz) - Creation timestamp
    - `updated_at` (timestamptz) - Last update timestamp

  ## Security
  - Enable RLS on `user_drive_folder_mappings`
  - Users can only view and manage their own folder mappings
  - Admins can view all folder mappings
  - Users can only map to departments they have access to

  ## Important Notes
  - Each user can have multiple folder mappings
  - Each folder must be mapped to exactly one department
  - Folder ID is automatically extracted from the URL
  - The sync function will use these mappings to auto-assign departments to imported invoices
*/

-- Create user_drive_folder_mappings table
CREATE TABLE IF NOT EXISTS user_drive_folder_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  folder_name text NOT NULL,
  google_drive_folder_url text NOT NULL,
  google_drive_folder_id text,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_active boolean DEFAULT true,
  last_sync_at timestamptz,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE user_drive_folder_mappings ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own folder mappings"
  ON user_drive_folder_mappings
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all folder mappings"
  ON user_drive_folder_mappings
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Users can insert own folder mappings"
  ON user_drive_folder_mappings
  FOR INSERT
  TO authenticated
  WITH CHECK (
    auth.uid() = user_id
    AND (
      -- User must have access to the department
      EXISTS (
        SELECT 1 FROM user_department_access
        WHERE user_department_access.user_id = auth.uid()
        AND user_department_access.department_id = user_drive_folder_mappings.department_id
      )
      OR
      -- Or be admin
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
    )
  );

CREATE POLICY "Users can update own folder mappings"
  ON user_drive_folder_mappings
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (
    auth.uid() = user_id
    AND (
      -- User must have access to the department
      EXISTS (
        SELECT 1 FROM user_department_access
        WHERE user_department_access.user_id = auth.uid()
        AND user_department_access.department_id = user_drive_folder_mappings.department_id
      )
      OR
      -- Or be admin
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
    )
  );

CREATE POLICY "Users can delete own folder mappings"
  ON user_drive_folder_mappings
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Trigger to auto-extract folder ID and update timestamp
CREATE OR REPLACE FUNCTION update_folder_mapping_metadata()
RETURNS TRIGGER AS $$
BEGIN
  -- Extract folder ID from URL using existing function
  NEW.google_drive_folder_id := extract_drive_folder_id(NEW.google_drive_folder_url);

  -- Update timestamp
  NEW.updated_at := now();

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS auto_extract_folder_id_mapping ON user_drive_folder_mappings;
CREATE TRIGGER auto_extract_folder_id_mapping
  BEFORE INSERT OR UPDATE ON user_drive_folder_mappings
  FOR EACH ROW
  EXECUTE FUNCTION update_folder_mapping_metadata();

-- Create indexes for faster lookups
CREATE INDEX IF NOT EXISTS idx_user_drive_folder_mappings_user_id
  ON user_drive_folder_mappings(user_id);

CREATE INDEX IF NOT EXISTS idx_user_drive_folder_mappings_department_id
  ON user_drive_folder_mappings(department_id);

CREATE INDEX IF NOT EXISTS idx_user_drive_folder_mappings_is_active
  ON user_drive_folder_mappings(is_active);

CREATE INDEX IF NOT EXISTS idx_user_drive_folder_mappings_folder_id
  ON user_drive_folder_mappings(google_drive_folder_id);
