/*
  # Skip Slack notifications for draft invoices
  
  Update notify_slack_on_notification to skip sending Slack messages
  when the notification type is 'invoice_draft_received'.
  Draft invoice notifications should remain in-app only.
*/

CREATE OR REPLACE FUNCTION notify_slack_on_notification()
RETURNS TRIGGER AS $$
DECLARE
  v_slack_enabled boolean;
  v_project_url text;
BEGIN
  IF NEW.type = 'invoice_draft_received' THEN
    RETURN NEW;
  END IF;

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
