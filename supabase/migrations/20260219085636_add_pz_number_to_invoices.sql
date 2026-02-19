/*
  # Add pz_number column to invoices

  ## Summary
  Adds a new optional text field `pz_number` (Powiązanie z PZ) to the invoices table.
  This field stores the PZ (Przyjęcie Zewnętrzne / goods receipt) reference number
  for linking invoices to warehouse receipts in external systems.

  ## Changes
  - `invoices` table: new nullable text column `pz_number`

  ## Notes
  - No RLS changes required — existing invoice policies cover this column automatically
  - No default value; the field is optional
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'pz_number'
  ) THEN
    ALTER TABLE invoices ADD COLUMN pz_number text;
  END IF;
END $$;
