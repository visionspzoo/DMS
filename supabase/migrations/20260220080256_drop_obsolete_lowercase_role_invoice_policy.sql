/*
  # Remove obsolete lowercase-role invoice SELECT policy

  The policy "Users can view invoices based on role and ownership" used lowercase
  role values (kierownik, dyrektor, specjalista) which do not match the actual
  values stored in profiles.role (Kierownik, Dyrektor, Specjalista).
  
  This policy was ineffective and is superseded by the corrected
  "Users can view invoices based on role and department" policy.
*/

DROP POLICY IF EXISTS "Users can view invoices based on role and ownership" ON invoices;
