
/*
  # Fix purchase requests visibility for managers and directors

  ## Problem
  Managers and directors could only see purchase requests when they were
  the current_approver_id. After approving (and the approver changes),
  they lost visibility.

  ## Solution
  Add a SELECT policy that allows managers and directors to always see
  all purchase requests from their subordinates (users in departments
  where they are the manager or director).

  ## New Policy
  - "Managers and directors can view subordinate purchase requests"
    - Managers see requests from users in their department
    - Directors see requests from users in any department they direct
*/

CREATE POLICY "Managers and directors can view subordinate purchase requests"
  ON purchase_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM profiles p
      JOIN departments d ON d.id = p.department_id
      WHERE p.id = purchase_requests.user_id
        AND (
          d.manager_id = auth.uid()
          OR d.director_id = auth.uid()
        )
    )
  );
