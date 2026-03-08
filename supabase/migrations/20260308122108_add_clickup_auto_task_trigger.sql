/*
  # Auto-create ClickUp task when purchase request is approved

  ## Overview
  Adds a database trigger that automatically calls the `create-clickup-task`
  edge function via pg_net whenever a purchase_request row transitions to
  status = 'approved' AND does not already have a clickup_task_id.

  This replaces the unreliable client-side trigger and ensures the task is
  always created regardless of which path leads to the final approval
  (manager-only, director-only, or manager → director chain).

  ## Changes
  - Creates function `notify_clickup_on_approval` using pg_net HTTP POST
  - Creates trigger `tr_clickup_on_approval` AFTER UPDATE on purchase_requests
*/

CREATE OR REPLACE FUNCTION notify_clickup_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://mzncjizbhvrqyyzclqxi.supabase.co/functions/v1/create-clickup-task';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16bmNqaXpiaHZycXl5emNscXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTU4NzgsImV4cCI6MjA4NTg3MTg3OH0.ytEULytrVrtmNFdc728DJWhh3bL1J6kQBen5DROeCCU';
BEGIN
  IF NEW.status = 'approved'
     AND (OLD.status IS DISTINCT FROM 'approved')
     AND NEW.clickup_task_id IS NULL
  THEN
    PERFORM net.http_post(
      url     => v_url,
      headers => jsonb_build_object(
        'Content-Type', 'application/json',
        'Authorization', 'Bearer ' || v_anon_key,
        'apikey', v_anon_key
      ),
      body    => jsonb_build_object('purchase_request_id', NEW.id)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_clickup_on_approval ON purchase_requests;
CREATE TRIGGER tr_clickup_on_approval
  AFTER UPDATE ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_clickup_on_approval();
