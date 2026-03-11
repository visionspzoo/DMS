/*
  # Fix: Directors can approve purchase requests from their department

  ## Problem
  The `process_purchase_request_approval` function only allows the user explicitly
  set as `current_approver_id` to act. If a request is pending with a manager
  (Kierownik) as current approver, the department director cannot approve it even
  though they have authority over all subordinates.

  `get_purchase_requests_for_approval` also only returns requests where
  `current_approver_id = auth.uid()`, so directors never see requests pending
  with their subordinate managers.

  ## Changes
  1. `process_purchase_request_approval` — also allows the department director to
     approve/reject any non-final request from their department.
  2. `get_purchase_requests_for_approval` — also returns pending requests from the
     director's department where the request is still in progress (not yet
     approved/rejected/paid).

  ## Security
  - Directors can only act on requests from departments where they are the director.
  - Admins retain full access as before.
*/

-- -------------------------------------------------------
-- 1. Update process_purchase_request_approval to allow directors
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION process_purchase_request_approval(
  p_request_id uuid,
  p_action text,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_request purchase_requests%ROWTYPE;
  v_approver_role text;
  v_dept_id uuid;
  v_director_id uuid;
  v_is_admin boolean;
  v_is_dept_director boolean;
BEGIN
  SELECT * INTO v_request FROM purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wniosek nie istnieje');
  END IF;

  SELECT role, is_admin INTO v_approver_role, v_is_admin FROM profiles WHERE id = auth.uid();

  -- Check if current user is the director of the request's department
  v_dept_id := v_request.department_id;
  v_is_dept_director := false;
  IF v_dept_id IS NOT NULL THEN
    SELECT director_id INTO v_director_id FROM departments WHERE id = v_dept_id;
    IF v_director_id = auth.uid() THEN
      v_is_dept_director := true;
    END IF;
  END IF;

  -- Allow: assigned approver, admin, or department director
  IF v_request.current_approver_id IS DISTINCT FROM auth.uid()
     AND NOT v_is_admin
     AND NOT v_is_dept_director THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brak uprawnień do rozpatrzenia tego wniosku');
  END IF;

  -- Cannot act on already-finalised requests
  IF v_request.status IN ('approved', 'rejected', 'paid') THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wniosek został już rozpatrzony');
  END IF;

  -- Record this approval step
  INSERT INTO purchase_request_approvals(purchase_request_id, approver_id, role, action, comment)
  VALUES (p_request_id, auth.uid(), v_approver_role, p_action, p_comment);

  -- Rejection: end the workflow
  IF p_action = 'rejected' THEN
    UPDATE purchase_requests
    SET status = 'rejected', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- Approval path
  -- If the acting user is the department director (or admin), fully approve
  IF v_is_dept_director OR v_is_admin THEN
    UPDATE purchase_requests
    SET status = 'approved', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'approved');
  END IF;

  -- Acting user is the assigned manager — check if director escalation is needed
  IF v_approver_role = 'Kierownik' AND v_director_id IS NOT NULL AND v_director_id != auth.uid() THEN
    UPDATE purchase_requests
    SET current_approver_id = v_director_id, approver_comment = p_comment, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'waiting_director');
  END IF;

  -- Final approval (no director, or manager is also director)
  UPDATE purchase_requests
  SET status = 'approved', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$$;

GRANT EXECUTE ON FUNCTION process_purchase_request_approval(uuid, text, text) TO authenticated;

-- -------------------------------------------------------
-- 2. Update get_purchase_requests_for_approval to include director's department
-- -------------------------------------------------------
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
  has_director boolean
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
    (d.director_id IS NOT NULL AND d.director_id != auth.uid()) AS has_director
  FROM purchase_requests pr
  LEFT JOIN profiles p ON p.id = pr.user_id
  LEFT JOIN departments d ON d.id = pr.department_id
  WHERE
    -- Directly assigned approver
    pr.current_approver_id = auth.uid()
    -- OR: current user is the director of the request's department and request is still pending
    OR (
      d.director_id = auth.uid()
      AND pr.status NOT IN ('approved', 'rejected', 'paid')
      AND pr.user_id != auth.uid()
    )
  ORDER BY pr.submitted_at ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_purchase_requests_for_approval() TO authenticated;
