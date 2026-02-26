/*
  # Add bez_mpk to nip_automation_rules

  ## Summary
  Extends the NIP automation rules with an option to automatically set the "Bez MPK" flag on matched invoices.

  1. Modified Tables
    - `nip_automation_rules`
      - `auto_bez_mpk` (boolean, default false) — when true, automatically marks the invoice as "Bez MPK" upon matching
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nip_automation_rules' AND column_name = 'auto_bez_mpk'
  ) THEN
    ALTER TABLE nip_automation_rules ADD COLUMN auto_bez_mpk boolean NOT NULL DEFAULT false;
  END IF;
END $$;
