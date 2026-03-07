/*
  # ClickUp Integration

  1. New Tables
    - `clickup_config`
      - `id` (uuid, primary key)
      - `api_token` (text) - ClickUp Personal API Token
      - `list_id` (text) - Target ClickUp list ID where tasks will be created
      - `enabled` (boolean) - Whether integration is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, FK to profiles)

  2. Modified Tables
    - `purchase_requests` - add `clickup_task_id` column to track created tasks

  3. Security
    - RLS enabled on `clickup_config`
    - Only admins can read/write config
*/

CREATE TABLE IF NOT EXISTS clickup_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_token text NOT NULL DEFAULT '',
  list_id text NOT NULL DEFAULT '',
  enabled boolean NOT NULL DEFAULT false,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE clickup_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can read clickup config"
  ON clickup_config FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role IN ('Dyrektor', 'Kierownik'))
    )
  );

CREATE POLICY "Admins can insert clickup config"
  ON clickup_config FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update clickup config"
  ON clickup_config FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'clickup_task_id'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN clickup_task_id text;
  END IF;
END $$;
