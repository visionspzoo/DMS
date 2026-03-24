/*
  # Fix purchase requests visibility for managers and directors

  ## Problem
  The existing RLS policy "Managers and directors can view subordinate purchase requests"
  uses profiles.department_id to check if a request belongs to a manager/director's department.
  This is incorrect because:
  1. Users can be in multiple departments (via department_members table)
  2. profiles.department_id may not match the department managed by the current user

  ## Changes
  1. Drop and recreate the SELECT RLS policy using department_members table
  2. Update get_purchase_requests_for_approval() to also use department_members
     so directors/managers see requests from ALL their subordinates

  ## Security
  - Managers can only see requests from users who are members of their managed departments
  - Directors can only see requests from users who are members of their directed departments
  - Admins retain full access
*/

-- Drop old policy that uses profiles.department_id (incorrect)
DROP POLICY IF EXISTS "Managers and directors can view subordinate purchase requests" ON purchase_requests;

-- Create new correct policy using department_members
CREATE POLICY "Managers and directors can view subordinate purchase requests"
  ON purchase_requests
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM department_members dm
      JOIN departments d ON d.id = dm.department_id
      WHERE dm.user_id = purchase_requests.user_id
        AND (d.manager_id = auth.uid() OR d.director_id = auth.uid())
    )
  );

-- Update get_purchase_requests_for_approval to use department_members
-- so directors see requests from all their subordinates (not just by department_id)
CREATE OR REPLACE FUNCTION get_purchase_requests_for_approval()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  submitter_name text,
  submitter_email text,
  department_id uuid,
  department_name text,
  link text,
  gross_amount numeric,
  description text,
  quantity integer,
  delivery_location text,
  priority text,
  status text,
  current_approver_id uuid,
  approver_comment text,
  submitted_at timestamptz,
  created_at timestamptz,
  proforma_filename text,
  has_director boolean,
  waiting_for_manager boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.id,
    pr.user_id,
    p.full_name AS submitter_name,
    p.email AS submitter_email,
    pr.department_id,
    d.name AS department_name,
    pr.link,
    pr.gross_amount,
    pr.description,
    pr.quantity,
    pr.delivery_location,
    pr.priority,
    pr.status,
    pr.current_approver_id,
    pr.approver_comment,
    pr.submitted_at,
    pr.created_at,
    pr.proforma_filename,
    (d.director_id IS NOT NULL AND d.director_id != auth.uid()) AS has_director,
    (
      d.director_id = auth.uid()
      AND pr.current_approver_id IS NOT NULL
      AND pr.current_approver_id != auth.uid()
    ) AS waiting_for_manager
  FROM purchase_requests pr
  LEFT JOIN profiles p ON p.id = pr.user_id
  LEFT JOIN departments d ON d.id = pr.department_id
  WHERE
    pr.status NOT IN ('approved', 'rejected', 'paid')
    AND pr.user_id != auth.uid()
    AND (
      -- Directly assigned as approver
      pr.current_approver_id = auth.uid()
      OR
      -- Director of the department where the request was submitted
      EXISTS (
        SELECT 1 FROM departments dept2
        WHERE dept2.id = pr.department_id
          AND dept2.director_id = auth.uid()
      )
      OR
      -- Director of any department the submitter belongs to
      EXISTS (
        SELECT 1 FROM department_members dm2
        JOIN departments dept3 ON dept3.id = dm2.department_id
        WHERE dm2.user_id = pr.user_id
          AND dept3.director_id = auth.uid()
      )
    )
  ORDER BY pr.submitted_at ASC NULLS LAST;
END;
$$;
