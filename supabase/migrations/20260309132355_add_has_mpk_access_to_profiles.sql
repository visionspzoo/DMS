/*
  # Add has_mpk_access flag to profiles

  ## Summary
  Adds a boolean flag `has_mpk_access` to the profiles table.

  ## Changes
  - `profiles.has_mpk_access` (boolean, default false) — when true, user can see:
    - "BEZ MPK: Brak powiązania" filter in invoice list
    - "Właściciel" filter in invoice list
    - "Powiązanie z PZ" field in invoice details
    - "Przypisz do kosztów BEZ MPK" checkbox in invoice details

  ## Notes
  - Admins always see these options regardless of this flag
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'has_mpk_access'
  ) THEN
    ALTER TABLE profiles ADD COLUMN has_mpk_access boolean NOT NULL DEFAULT false;
  END IF;
END $$;
