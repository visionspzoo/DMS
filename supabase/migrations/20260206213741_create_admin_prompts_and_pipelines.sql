/*
  # Create admin AI prompts and pipelines system

  1. New Tables
    - `contract_admin_prompts` - Admin-managed prompts visible to all users
      - `id` (uuid, primary key)
      - `name` (text) - display name
      - `prompt_text` (text) - prompt content
      - `created_by` (uuid) - admin who created it
      - `is_active` (boolean) - visibility toggle
      - `created_at` (timestamptz)

    - `contract_pipelines` - Pipeline definitions (sequences of prompts)
      - `id` (uuid, primary key)
      - `name` (text) - display name
      - `description` (text) - optional description
      - `created_by` (uuid) - admin who created it
      - `is_active` (boolean) - visibility toggle
      - `created_at` (timestamptz)

    - `contract_pipeline_steps` - Individual steps within a pipeline
      - `id` (uuid, primary key)
      - `pipeline_id` (uuid) - which pipeline this step belongs to
      - `step_order` (integer) - execution order
      - `step_name` (text) - display name for the step
      - `prompt_text` (text) - the AI prompt for this step
      - `created_at` (timestamptz)

  2. Security
    - RLS enabled on all tables
    - All authenticated users can view active items
    - Only admin users can create, update, and delete
*/

CREATE TABLE IF NOT EXISTS contract_admin_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  prompt_text text NOT NULL,
  created_by uuid NOT NULL REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_admin_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active admin prompts or admins see all"
  ON contract_admin_prompts
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert admin prompts"
  ON contract_admin_prompts
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update admin prompts"
  ON contract_admin_prompts
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete admin prompts"
  ON contract_admin_prompts
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE TABLE IF NOT EXISTS contract_pipelines (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  created_by uuid NOT NULL REFERENCES auth.users(id),
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_pipelines ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view active pipelines or admins see all"
  ON contract_pipelines
  FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can insert pipelines"
  ON contract_pipelines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update pipelines"
  ON contract_pipelines
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete pipelines"
  ON contract_pipelines
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE TABLE IF NOT EXISTS contract_pipeline_steps (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  pipeline_id uuid NOT NULL REFERENCES contract_pipelines(id) ON DELETE CASCADE,
  step_order integer NOT NULL DEFAULT 0,
  step_name text NOT NULL,
  prompt_text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_pipeline_steps ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view steps of visible pipelines"
  ON contract_pipeline_steps
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contract_pipelines
      WHERE contract_pipelines.id = pipeline_id
      AND (
        contract_pipelines.is_active = true
        OR EXISTS (
          SELECT 1 FROM profiles
          WHERE profiles.id = auth.uid() AND profiles.is_admin = true
        )
      )
    )
  );

CREATE POLICY "Admins can insert pipeline steps"
  ON contract_pipeline_steps
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update pipeline steps"
  ON contract_pipeline_steps
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete pipeline steps"
  ON contract_pipeline_steps
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );
