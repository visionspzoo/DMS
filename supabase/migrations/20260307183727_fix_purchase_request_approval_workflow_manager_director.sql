/*
  # Fix Purchase Request Approval Workflow: Specialist → Manager → Director

  ## Overview
  Redesigns the approval flow so that:
  1. When a Specialist submits a request, it ALWAYS goes to the department Manager first (if exists)
  2. When the Manager approves, it ALWAYS escalates to the department Director (if exists)
  3. Only after the Director approves is the request fully approved
  4. If there is no Manager, the request goes directly to the Director
  5. If there is no Director either, it is auto-approved

  ## Changes
  - Rewrites `assign_purchase_request_approver` trigger to always route to manager first
  - Rewrites `process_purchase_request_approval` RPC to always escalate approved requests from manager to director
  - The `purchase_request_limits` table is no longer used for routing decisions (limits may still be used for display/info)

  ## Notes
  - Existing `purchase_request_limits` table and data are preserved
  - Existing pending requests are unaffected
*/

-- -------------------------------------------------------
-- 1. Rewrite trigger: always assign manager first
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION assign_purchase_request_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dept_id uuid;
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  -- Determine target department
  v_dept_id := NEW.department_id;
  IF v_dept_id IS NULL THEN
    SELECT department_id INTO v_dept_id FROM profiles WHERE id = NEW.user_id;
  END IF;

  IF v_dept_id IS NOT NULL THEN
    SELECT manager_id, director_id INTO v_manager_id, v_director_id
    FROM departments WHERE id = v_dept_id;
  END IF;

  -- Always route to manager first if one exists
  -- If no manager but director exists, route to director
  -- If neither, auto-approve
  IF v_manager_id IS NOT NULL AND v_manager_id != NEW.user_id THEN
    NEW.current_approver_id := v_manager_id;
  ELSIF v_director_id IS NOT NULL AND v_director_id != NEW.user_id THEN
    NEW.current_approver_id := v_director_id;
  ELSE
    NEW.status := 'approved';
    NEW.current_approver_id := NULL;
  END IF;

  NEW.submitted_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_assign_purchase_request_approver ON purchase_requests;
CREATE TRIGGER tr_assign_purchase_request_approver
  BEFORE INSERT ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION assign_purchase_request_approver();

-- -------------------------------------------------------
-- 2. Rewrite RPC: manager approval always escalates to director
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
BEGIN
  SELECT * INTO v_request FROM purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Wniosek nie istnieje');
  END IF;

  SELECT role, is_admin INTO v_approver_role, v_is_admin FROM profiles WHERE id = auth.uid();

  -- Only the current approver or an admin can act
  IF v_request.current_approver_id IS DISTINCT FROM auth.uid() AND NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Brak uprawnień do rozpatrzenia tego wniosku');
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

  -- Approval path: check if director needs to approve next
  v_dept_id := v_request.department_id;

  IF v_dept_id IS NOT NULL THEN
    SELECT director_id INTO v_director_id FROM departments WHERE id = v_dept_id;
  END IF;

  -- If the current approver is the manager (Kierownik) and a separate director exists, escalate
  IF v_approver_role = 'Kierownik' AND v_director_id IS NOT NULL AND v_director_id != auth.uid() THEN
    UPDATE purchase_requests
    SET current_approver_id = v_director_id, approver_comment = p_comment, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'waiting_director');
  END IF;

  -- Final approval (director approved, or manager is also director, or no director)
  UPDATE purchase_requests
  SET status = 'approved', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$$;

GRANT EXECUTE ON FUNCTION process_purchase_request_approval(uuid, text, text) TO authenticated;
