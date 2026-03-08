/*
  # Fix ClickUp trigger - skip proforma purchase requests

  ## Changes
  - Updates `notify_clickup_on_approval` trigger function
  - Proforma requests (proforma_pdf_base64 IS NOT NULL) are excluded from
    automatic ClickUp task creation
  - Non-proforma requests continue to get ClickUp tasks on approval as before
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
  -- Skip proforma requests - they use the external API instead
  IF NEW.proforma_pdf_base64 IS NOT NULL THEN
    RETURN NEW;
  END IF;

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
