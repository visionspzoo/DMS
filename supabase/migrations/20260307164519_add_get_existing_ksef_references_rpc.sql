/*
  # Add RPC to get all existing KSEF reference numbers

  This function bypasses RLS to return all ksef_reference_number values
  that already exist in the database. Used for efficient duplicate detection
  during KSEF sync - any authenticated user can call it, but only gets
  back the reference numbers (no sensitive data), allowing the frontend
  to skip already-downloaded invoices regardless of RLS visibility rules.
*/

CREATE OR REPLACE FUNCTION get_existing_ksef_references()
RETURNS TABLE(ksef_reference_number text)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT ksef_reference_number FROM ksef_invoices;
$$;

GRANT EXECUTE ON FUNCTION get_existing_ksef_references() TO authenticated;
