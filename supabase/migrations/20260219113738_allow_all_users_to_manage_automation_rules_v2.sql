/*
  # Allow all authenticated users to manage NIP automation rules

  ## Changes

  1. Updated RLS policies for `nip_automation_rules`
     - All authenticated users can now insert their own rules (created_by = auth.uid())
     - Users can update/delete their own rules
     - Admins can manage all rules
     - SELECT: all authenticated users can see active rules + their own inactive rules

  2. Updated RLS policies for `nip_automation_rule_tags`
     - All authenticated users can insert/delete tags for rules they own
     - Admins can manage all tag associations
*/

-- Drop existing policies
DROP POLICY IF EXISTS "Admins can insert automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Admins can update automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Admins can delete automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Authenticated users can insert own automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Users can update own automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Users can delete own automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Authenticated users can read active automation rules" ON nip_automation_rules;
DROP POLICY IF EXISTS "Users can read own and active automation rules" ON nip_automation_rules;

DROP POLICY IF EXISTS "Admins can insert automation rule tags" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Admins can delete automation rule tags" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Users can insert tags for own automation rules" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Users can delete tags for own automation rules" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Authenticated users can read automation rule tags" ON nip_automation_rule_tags;
DROP POLICY IF EXISTS "Users can read tags for accessible rules" ON nip_automation_rule_tags;

-- Recreate SELECT: active rules visible to all, own rules visible to creator, admins see all
CREATE POLICY "Users can read own and active automation rules"
  ON nip_automation_rules FOR SELECT
  TO authenticated
  USING (
    is_active = true
    OR created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Allow all authenticated users to insert their own rules
CREATE POLICY "Authenticated users can insert own automation rules"
  ON nip_automation_rules FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

-- Allow users to update their own rules, admins can update all
CREATE POLICY "Users can update own automation rules"
  ON nip_automation_rules FOR UPDATE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Allow users to delete their own rules, admins can delete all
CREATE POLICY "Users can delete own automation rules"
  ON nip_automation_rules FOR DELETE
  TO authenticated
  USING (
    created_by = auth.uid()
    OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- nip_automation_rule_tags policies
CREATE POLICY "Users can read tags for accessible rules"
  ON nip_automation_rule_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE nip_automation_rules.id = nip_automation_rule_tags.rule_id
      AND (
        nip_automation_rules.is_active = true
        OR nip_automation_rules.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      )
    )
  );

CREATE POLICY "Users can insert tags for own automation rules"
  ON nip_automation_rule_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE nip_automation_rules.id = nip_automation_rule_tags.rule_id
      AND (
        nip_automation_rules.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      )
    )
  );

CREATE POLICY "Users can delete tags for own automation rules"
  ON nip_automation_rule_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE nip_automation_rules.id = nip_automation_rule_tags.rule_id
      AND (
        nip_automation_rules.created_by = auth.uid()
        OR EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
      )
    )
  );
