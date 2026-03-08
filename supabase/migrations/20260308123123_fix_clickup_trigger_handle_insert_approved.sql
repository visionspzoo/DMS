/*
  # Fix ClickUp trigger to also fire on INSERT

  ## Problem
  The existing trigger `tr_clickup_on_approval` only fires on UPDATE.
  When a purchase request is created directly with status = 'approved'
  (e.g. by a manager who auto-approves within their own limit), the trigger
  never fires and no ClickUp task is created.

  ## Changes
  - Recreates `notify_clickup_on_approval` to handle both INSERT and UPDATE
  - On INSERT: fires if NEW.status = 'approved' and clickup_task_id IS NULL
  - On UPDATE: fires if status changed TO 'approved' and clickup_task_id IS NULL
  - Drops old UPDATE-only trigger and creates new one for INSERT OR UPDATE
*/

CREATE OR REPLACE FUNCTION notify_clickup_on_approval()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_url text := 'https://mzncjizbhvrqyyzclqxi.supabase.co/functions/v1/create-clickup-task';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16bmNqaXpiaHZycXl5emNscXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTU4NzgsImV4cCI6MjA4NTg3MTg3OH0.ytEULytrVrtmNFdc728DJWhh3bL1J6kQBen5DROeCCU';
  v_should_fire boolean := false;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_fire := NEW.status = 'approved' AND NEW.clickup_task_id IS NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_fire := NEW.status = 'approved'
      AND (OLD.status IS DISTINCT FROM 'approved')
      AND NEW.clickup_task_id IS NULL;
  END IF;

  IF v_should_fire THEN
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
  AFTER INSERT OR UPDATE ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_clickup_on_approval();
