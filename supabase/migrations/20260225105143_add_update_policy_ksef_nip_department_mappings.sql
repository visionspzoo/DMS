/*
  # Add UPDATE policy for ksef_nip_department_mappings

  ## Problem
  The table had no UPDATE RLS policy, causing edits to supplier name, department,
  and assigned user to silently fail.

  ## Changes
  - Add UPDATE policy allowing non-specialists to update NIP mappings
*/

CREATE POLICY "Non-specialists can update NIP mappings"
  ON ksef_nip_department_mappings
  FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role <> 'specialist'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role <> 'specialist'
    )
  );
