/*
  # Allow users to create their own pipelines

  1. Changes
    - Add `user_id` (nullable uuid) to `contract_pipelines`
      - NULL = admin/system pipeline (visible to all)
      - SET = personal pipeline (visible only to owner)

  2. Security
    - Updated SELECT: users see active system pipelines + their own
    - Updated INSERT: users can create pipelines with their own user_id
    - Updated UPDATE/DELETE: users manage their own, admins manage system ones
    - Pipeline steps policies updated to respect pipeline ownership
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_pipelines' AND column_name = 'user_id'
  ) THEN
    ALTER TABLE contract_pipelines ADD COLUMN user_id uuid REFERENCES auth.users(id);
  END IF;
END $$;

DROP POLICY IF EXISTS "Users can view active pipelines or admins see all" ON contract_pipelines;
CREATE POLICY "Users can view pipelines"
  ON contract_pipelines
  FOR SELECT
  TO authenticated
  USING (
    (is_active = true AND user_id IS NULL)
    OR (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can insert pipelines" ON contract_pipelines;
CREATE POLICY "Users and admins can insert pipelines"
  ON contract_pipelines
  FOR INSERT
  TO authenticated
  WITH CHECK (
    (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can update pipelines" ON contract_pipelines;
CREATE POLICY "Users and admins can update pipelines"
  ON contract_pipelines
  FOR UPDATE
  TO authenticated
  USING (
    (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  )
  WITH CHECK (
    (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can delete pipelines" ON contract_pipelines;
CREATE POLICY "Users and admins can delete pipelines"
  ON contract_pipelines
  FOR DELETE
  TO authenticated
  USING (
    (user_id = auth.uid())
    OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
  );

DROP POLICY IF EXISTS "Admins can insert pipeline steps" ON contract_pipeline_steps;
CREATE POLICY "Pipeline owners and admins can insert steps"
  ON contract_pipeline_steps
  FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contract_pipelines
      WHERE contract_pipelines.id = pipeline_id
      AND (
        contract_pipelines.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
      )
    )
  );

DROP POLICY IF EXISTS "Admins can update pipeline steps" ON contract_pipeline_steps;
CREATE POLICY "Pipeline owners and admins can update steps"
  ON contract_pipeline_steps
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contract_pipelines
      WHERE contract_pipelines.id = pipeline_id
      AND (
        contract_pipelines.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
      )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM contract_pipelines
      WHERE contract_pipelines.id = pipeline_id
      AND (
        contract_pipelines.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
      )
    )
  );

DROP POLICY IF EXISTS "Admins can delete pipeline steps" ON contract_pipeline_steps;
CREATE POLICY "Pipeline owners and admins can delete steps"
  ON contract_pipeline_steps
  FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contract_pipelines
      WHERE contract_pipelines.id = pipeline_id
      AND (
        contract_pipelines.user_id = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true)
      )
    )
  );
