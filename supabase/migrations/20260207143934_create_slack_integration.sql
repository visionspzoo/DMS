/*
  # Slack Integration System

  1. Extensions
    - Enable `pg_net` for async HTTP calls from DB triggers

  2. New Tables
    - `slack_config`
      - `id` (uuid, primary key)
      - `bot_token` (text) - Slack Bot OAuth token
      - `default_channel_id` (text) - Default Slack channel for notifications
      - `enabled` (boolean) - Whether Slack integration is active
      - `updated_at` (timestamptz)
      - `updated_by` (uuid, references profiles)
    - `slack_user_mappings`
      - `id` (uuid, primary key)
      - `user_id` (uuid, references profiles) - Supabase user
      - `slack_user_id` (text) - Slack member ID for DMs
      - `created_at` (timestamptz)

  3. Security
    - RLS enabled on both tables
    - Only admins can manage slack_config and slack_user_mappings

  4. Notification Types
    - Extend notifications type constraint to support contract events

  5. Triggers
    - New contract notification trigger (on insert/update of contracts)
    - Slack forwarding trigger (on insert into notifications, calls edge function via pg_net)
*/

-- Enable pg_net for async HTTP from triggers
CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions;

-- =============================================
-- Slack Config Table (singleton, admin-managed)
-- =============================================
CREATE TABLE IF NOT EXISTS slack_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bot_token text NOT NULL DEFAULT '',
  default_channel_id text DEFAULT '',
  enabled boolean DEFAULT false,
  updated_at timestamptz DEFAULT now(),
  updated_by uuid REFERENCES profiles(id)
);

ALTER TABLE slack_config ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view slack config"
  ON slack_config FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can insert slack config"
  ON slack_config FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update slack config"
  ON slack_config FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- =============================================
-- Slack User Mappings Table
-- =============================================
CREATE TABLE IF NOT EXISTS slack_user_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  slack_user_id text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE slack_user_mappings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view all slack mappings"
  ON slack_user_mappings FOR SELECT TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can insert slack mappings"
  ON slack_user_mappings FOR INSERT TO authenticated
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can update slack mappings"
  ON slack_user_mappings FOR UPDATE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true))
  WITH CHECK (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

CREATE POLICY "Admins can delete slack mappings"
  ON slack_user_mappings FOR DELETE TO authenticated
  USING (EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true));

-- =============================================
-- Extend notification types for contracts
-- =============================================
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type IN ('new_invoice', 'status_change', 'pending_review', 'new_contract', 'contract_status_change'));

-- =============================================
-- Contract notification triggers
-- =============================================
CREATE OR REPLACE FUNCTION notify_new_contract()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
BEGIN
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;

  INSERT INTO notifications (user_id, type, title, message)
  VALUES (
    NEW.uploaded_by,
    'new_contract',
    'Nowa umowa dodana',
    'Umowa ' || COALESCE(NEW.contract_number, NEW.title) || ' zostala dodana do systemu'
  );

  IF NEW.department_id IS NOT NULL THEN
    SELECT manager_id INTO v_manager_id
    FROM departments
    WHERE id = NEW.department_id;

    IF v_manager_id IS NOT NULL AND v_manager_id <> NEW.uploaded_by THEN
      INSERT INTO notifications (user_id, type, title, message)
      VALUES (
        v_manager_id,
        'new_contract',
        'Nowa umowa do przeglądu',
        'Umowa ' || COALESCE(NEW.contract_number, NEW.title) || ' wymaga Twojej uwagi'
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS new_contract_notification ON contracts;
CREATE TRIGGER new_contract_notification
  AFTER INSERT ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_contract();

CREATE OR REPLACE FUNCTION notify_contract_status_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status AND NEW.status <> 'draft' THEN
    INSERT INTO notifications (user_id, type, title, message)
    VALUES (
      NEW.uploaded_by,
      'contract_status_change',
      'Status umowy zmieniony',
      'Umowa ' || COALESCE(NEW.contract_number, NEW.title) || ' - nowy status: ' || NEW.status
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS contract_status_change_notification ON contracts;
CREATE TRIGGER contract_status_change_notification
  AFTER UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION notify_contract_status_change();

-- =============================================
-- Slack forwarding trigger on notifications
-- =============================================
CREATE OR REPLACE FUNCTION notify_slack_on_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_slack_enabled boolean;
  v_project_url text;
BEGIN
  SELECT enabled INTO v_slack_enabled FROM slack_config LIMIT 1;

  IF v_slack_enabled IS TRUE THEN
    v_project_url := current_setting('app.settings.supabase_url', true);
    IF v_project_url IS NULL OR v_project_url = '' THEN
      v_project_url := 'https://mzncjizbhvrqyyzclqxi.supabase.co';
    END IF;

    PERFORM net.http_post(
      url := v_project_url || '/functions/v1/send-slack-notification',
      headers := '{"Content-Type": "application/json"}'::jsonb,
      body := jsonb_build_object(
        'user_id', NEW.user_id,
        'title', NEW.title,
        'message', NEW.message,
        'type', NEW.type,
        'notification_id', NEW.id
      )
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS slack_notification_trigger ON notifications;
CREATE TRIGGER slack_notification_trigger
  AFTER INSERT ON notifications
  FOR EACH ROW
  EXECUTE FUNCTION notify_slack_on_notification();

-- Indexes
CREATE INDEX IF NOT EXISTS idx_slack_user_mappings_user_id ON slack_user_mappings(user_id);
