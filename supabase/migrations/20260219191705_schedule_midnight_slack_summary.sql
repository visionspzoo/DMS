/*
  # Schedule midnight Slack summary

  Adds a daily cron job that runs at 00:00 (midnight UTC) and calls
  the `midnight-summary` edge function. This function sends each
  mapped Slack user a personal DM with:
    - Invoices waiting for their verification (status = 'waiting', current_approver_id = user)
    - Invoices returned for correction (status = 'draft', uploaded_by = user, current_approver_id not null)

  Only users with no pending/rejected invoices are skipped silently.
*/

SELECT cron.schedule(
  'midnight-slack-summary',
  '0 0 * * *',
  $$
  SELECT net.http_post(
    url := 'https://mzncjizbhvrqyyzclqxi.supabase.co/functions/v1/midnight-summary',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
