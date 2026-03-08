/*
  # Add webhook_id column to clickup_config

  Stores the ClickUp webhook ID after automatic registration,
  so the app can check if a webhook is already registered and
  avoid creating duplicates.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clickup_config' AND column_name = 'clickup_webhook_id'
  ) THEN
    ALTER TABLE clickup_config ADD COLUMN clickup_webhook_id text;
  END IF;
END $$;
