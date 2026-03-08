/*
  # Add ClickUp Field Mappings

  1. New Tables
    - `clickup_field_mappings`
      - `id` (uuid, primary key)
      - `clickup_field_id` (text) - ClickUp custom field ID
      - `clickup_field_name` (text) - ClickUp custom field display name
      - `clickup_field_type` (text) - type of ClickUp field (text, number, dropdown, etc.)
      - `app_field` (text) - field from purchase_request to map (e.g. 'description', 'gross_amount')
      - `app_field_label` (text) - human-readable label for the app field
      - `enabled` (boolean) - whether this mapping is active
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

  2. Security
    - Enable RLS on `clickup_field_mappings`
    - Admins can read and write
    - All authenticated users can read (needed to build task payload)

  3. Notes
    - Also adds `clickup_custom_fields` jsonb column to `clickup_config` for caching fetched fields
*/

CREATE TABLE IF NOT EXISTS clickup_field_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_field_id text NOT NULL,
  clickup_field_name text NOT NULL,
  clickup_field_type text NOT NULL DEFAULT 'text',
  app_field text NOT NULL,
  app_field_label text NOT NULL,
  enabled boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE clickup_field_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read field mappings"
  ON clickup_field_mappings FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert field mappings"
  ON clickup_field_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update field mappings"
  ON clickup_field_mappings FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete field mappings"
  ON clickup_field_mappings FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clickup_config' AND column_name = 'cached_custom_fields'
  ) THEN
    ALTER TABLE clickup_config ADD COLUMN cached_custom_fields jsonb DEFAULT '[]'::jsonb;
  END IF;
END $$;
