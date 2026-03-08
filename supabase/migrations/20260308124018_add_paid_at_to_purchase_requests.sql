/*
  # Add paid_at column to purchase_requests

  Stores exact timestamp when a purchase request was marked as paid
  (either via ClickUp webhook or manually).
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN paid_at timestamptz;
  END IF;
END $$;
