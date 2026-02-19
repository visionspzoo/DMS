/*
  # Add bez_mpk flag to invoices

  ## Changes

  1. New column in `invoices`
     - `bez_mpk` (boolean, default false) - when true, this invoice is explicitly marked as
       having no MPK (cost center). The MPK field will be treated as "BEZ MPK" in exports
       and the cost_center_id will be null.

  ## Notes
  - Only visible in the edit form when the user's profile has mpk_override_bez_mpk = true
  - When bez_mpk is checked, cost_center_id is set to null
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'bez_mpk'
  ) THEN
    ALTER TABLE invoices ADD COLUMN bez_mpk boolean NOT NULL DEFAULT false;
  END IF;
END $$;
