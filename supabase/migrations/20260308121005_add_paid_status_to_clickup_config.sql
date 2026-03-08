/*
  # Add paid_status to clickup_config

  ## Changes
  - Adds `paid_status` column to `clickup_config`
  - This stores the exact ClickUp status name that should trigger marking a purchase request as "paid"
  - Defaults to empty string (webhook will use fallback logic for common English statuses)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'clickup_config' AND column_name = 'paid_status'
  ) THEN
    ALTER TABLE clickup_config ADD COLUMN paid_status text NOT NULL DEFAULT '';
  END IF;
END $$;
