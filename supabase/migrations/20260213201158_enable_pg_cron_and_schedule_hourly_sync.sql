/*
  # Enable pg_cron and schedule hourly invoice sync

  1. Extensions
    - Enable `pg_cron` for scheduling periodic database tasks

  2. Scheduled Jobs
    - `sync-invoices-hourly`: Runs every hour at minute 0
    - Calls the `cron-sync-invoices` edge function via pg_net HTTP POST
    - The edge function finds all users with active sync configs
      that haven't synced in the last hour and triggers sync for each

  3. Security
    - The cron job runs server-side only (pg_cron is superuser-only)
    - The edge function validates requests internally using service role
    - The cron.job table is only accessible by privileged roles

  4. Important Notes
    - pg_net is already enabled
    - The edge function is deployed with verify_jwt=false for cron access
    - Syncs are skipped for users who synced less than 1 hour ago
*/

CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA pg_catalog;

GRANT USAGE ON SCHEMA cron TO postgres;
GRANT ALL PRIVILEGES ON ALL TABLES IN SCHEMA cron TO postgres;

SELECT cron.schedule(
  'sync-invoices-hourly',
  '0 * * * *',
  $$
  SELECT net.http_post(
    url := 'https://mzncjizbhvrqyyzclqxi.supabase.co/functions/v1/cron-sync-invoices',
    headers := '{"Content-Type": "application/json"}'::jsonb,
    body := '{}'::jsonb
  ) AS request_id;
  $$
);
