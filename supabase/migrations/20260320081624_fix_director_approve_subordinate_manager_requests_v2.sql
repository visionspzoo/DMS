/*
  # Fix: Director can approve purchase requests awaiting subordinate managers

  ## Problem
  When a purchase request is assigned to a manager (Kierownik) as current_approver_id,
  the department director cannot see or act on it via the approval queue — even though
  they have authority over all requests in their department.

  ## Changes

  ### get_purchase_requests_for_approval
  - Drop and recreate with a new `waiting_for_manager` boolean column.
  - Directors now see ALL non-final requests from their departments,
    even if current_approver_id points to a subordinate manager.
  - New flag `waiting_for_manager` = true when director is viewing a request
    that is still formally assigned to a subordinate manager (not yet escalated).
    This lets the UI show a contextual label like "Oczekuje u kierownika".

  ## Security
  - Directors can only act on requests from departments where they are director.
  - Admins retain full access via process_purchase_request_approval (unchanged).
*/

DROP FUNCTION IF EXISTS get_purchase_requests_for_approval();

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
    -- True when director sees a request still formally with a subordinate manager
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
      pr.current_approver_id = auth.uid()
      OR d.director_id = auth.uid()
    )
  ORDER BY pr.submitted_at ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_purchase_requests_for_approval() TO authenticated;
