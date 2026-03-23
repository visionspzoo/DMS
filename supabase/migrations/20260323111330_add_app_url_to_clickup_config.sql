/*
  # Add app_url to clickup_config

  Adds an `app_url` column to store the base URL of the application.
  This URL is used to generate direct deep-links to purchase requests
  when creating ClickUp tasks.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clickup_config' AND column_name = 'app_url'
  ) THEN
    ALTER TABLE clickup_config ADD COLUMN app_url text DEFAULT '';
  END IF;
END $$;
