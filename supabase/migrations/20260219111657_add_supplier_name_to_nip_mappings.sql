/*
  # Add supplier_name to ksef_nip_department_mappings

  ## Changes
  - Adds optional `supplier_name` text column to `ksef_nip_department_mappings`
  - Allows users to label each NIP mapping with the supplier's name for easier identification
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_nip_department_mappings' AND column_name = 'supplier_name'
  ) THEN
    ALTER TABLE ksef_nip_department_mappings ADD COLUMN supplier_name text;
  END IF;
END $$;
