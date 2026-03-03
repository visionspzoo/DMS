/*
  # Allow Kierownik to set limits for their subordinates

  ## Overview
  Extends `manager_limits` RLS policies so that a Kierownik (manager) can
  insert and update limits for users who belong to the same department where
  the Kierownik is the assigned manager.

  ## Changes
  - New INSERT policy: Kierownik can set limits for members of their managed department
  - New UPDATE policy: Kierownik can update limits for members of their managed department
  - These policies check that:
    1. The caller has role = 'Kierownik'
    2. The caller is the manager_id of the department that the target user belongs to

  ## Security
  - Managers can only set limits for direct subordinates (users in departments where they are manager_id)
  - Existing Director and Admin policies remain untouched
*/

CREATE POLICY "Managers can set limits for their department subordinates"
  ON manager_limits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'Kierownik'
    )
    AND EXISTS (
      SELECT 1 FROM departments d
      JOIN profiles target ON target.id = manager_limits.manager_id
      WHERE d.manager_id = auth.uid()
        AND target.department_id = d.id
    )
  );

CREATE POLICY "Managers can update limits for their department subordinates"
  ON manager_limits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
        AND p.role = 'Kierownik'
    )
    AND EXISTS (
      SELECT 1 FROM departments d
      JOIN profiles target ON target.id = manager_limits.manager_id
      WHERE d.manager_id = auth.uid()
        AND target.department_id = d.id
    )
  );
