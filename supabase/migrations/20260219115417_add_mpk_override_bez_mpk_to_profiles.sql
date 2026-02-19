/*
  # Add mpk_override_bez_mpk flag to profiles

  ## Changes

  1. New column in `profiles`
     - `mpk_override_bez_mpk` (boolean, default false) - when true, invoices uploaded by this user
       will have their department name and MPK code replaced with "BEZ MPK" in the export API

  ## Notes
  - This flag is managed by admins in the user settings panel
  - The override applies at export time in the invoices-export-api function
  - The actual invoice data is not changed, only the API response is modified
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'mpk_override_bez_mpk'
  ) THEN
    ALTER TABLE profiles ADD COLUMN mpk_override_bez_mpk boolean NOT NULL DEFAULT false;
  END IF;
END $$;

COMMENT ON COLUMN profiles.mpk_override_bez_mpk IS 'When true, invoices from this user will have their MPK code and department name replaced with BEZ MPK in the export API';
