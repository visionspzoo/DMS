/*
  # Add payment_method column to invoices

  ## Changes
  - Adds `payment_method` column to the `invoices` table
    - Allowed values: 'Gotówka', 'Przelew', 'Karta'
    - Nullable – only set when invoice is marked as paid

  ## Notes
  - No destructive changes
  - No RLS changes needed
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'payment_method'
  ) THEN
    ALTER TABLE invoices
      ADD COLUMN payment_method TEXT
        CHECK (payment_method IN ('Gotówka', 'Przelew', 'Karta'));
  END IF;
END $$;
