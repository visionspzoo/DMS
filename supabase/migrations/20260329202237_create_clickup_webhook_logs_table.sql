/*
  # Create ClickUp webhook logs table

  Stores raw payloads received from ClickUp webhooks for debugging.
  Auto-deletes entries older than 7 days to avoid bloat.
*/

CREATE TABLE IF NOT EXISTS clickup_webhook_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at timestamptz DEFAULT now(),
  event_name text,
  task_id text,
  extracted_status text,
  raw_payload jsonb,
  matched_paid boolean DEFAULT false,
  result_message text
);

ALTER TABLE clickup_webhook_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view webhook logs"
  ON clickup_webhook_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Service role can insert webhook logs"
  ON clickup_webhook_logs FOR INSERT
  TO service_role
  WITH CHECK (true);
