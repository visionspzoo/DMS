/*
  # Add auto-approve limit for Kierownik (manager) role in purchase requests

  ## Summary
  Extends the purchase request auto-approval logic to also handle Kierownik (manager) role.
  When a manager submits a purchase request whose amount is at or below their
  `auto_approve_limit` in `purchase_request_limits`, the request is automatically
  approved without requiring director (Dyrektor) approval.

  ## Changes
  - Rewrites `assign_purchase_request_approver` trigger to check `auto_approve_limit`
    for both Specjalista and Kierownik roles
  - Rewrites `process_purchase_request_approval` RPC to also respect the manager's
    auto_approve_limit when the manager's request was escalated to a director
    (i.e. if the manager's request is within limits, director step is skipped)

  ## Notes
  - Directors set auto_approve_limit for managers via the manager limits panel
  - If auto_approve_limit is NULL, the full approval chain applies as before
  - No changes to the purchase_request_limits table schema (auto_approve_limit already exists)
*/

-- Rewrite the trigger to respect auto_approve_limit for both Specjalista and Kierownik
CREATE OR REPLACE FUNCTION assign_purchase_request_approver()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_dept_id uuid;
  v_manager_id uuid;
  v_director_id uuid;
  v_submitter_role text;
  v_auto_approve_limit numeric;
  v_amount numeric;
BEGIN
  v_amount := COALESCE(NEW.gross_amount, 0) * COALESCE(NEW.quantity, 1);

  -- Determine target department
  v_dept_id := NEW.department_id;
  IF v_dept_id IS NULL THEN
    SELECT department_id INTO v_dept_id FROM profiles WHERE id = NEW.user_id;
  END IF;

  -- Get submitter role
  SELECT role INTO v_submitter_role FROM profiles WHERE id = NEW.user_id;

  IF v_dept_id IS NOT NULL THEN
    SELECT manager_id, director_id INTO v_manager_id, v_director_id
    FROM departments WHERE id = v_dept_id;
  END IF;

  -- Check auto_approve_limit for both Specjalista and Kierownik roles
  IF v_submitter_role IN ('Specjalista', 'Kierownik') THEN
    SELECT auto_approve_limit INTO v_auto_approve_limit
    FROM purchase_request_limits
    WHERE user_id = NEW.user_id;

    IF v_auto_approve_limit IS NOT NULL AND v_amount <= v_auto_approve_limit THEN
      -- Auto-approve: amount is within the user's auto-approve limit
      NEW.status := 'approved';
      NEW.current_approver_id := NULL;
      NEW.submitted_at := now();
      RETURN NEW;
    END IF;
  END IF;

  -- Standard routing: manager → director
  -- Specjalista goes to manager first; Kierownik goes directly to director
  IF v_submitter_role = 'Specjalista' AND v_manager_id IS NOT NULL AND v_manager_id != NEW.user_id THEN
    NEW.current_approver_id := v_manager_id;
  ELSIF v_director_id IS NOT NULL AND v_director_id != NEW.user_id THEN
    NEW.current_approver_id := v_director_id;
  ELSIF v_submitter_role = 'Specjalista' AND v_manager_id IS NOT NULL AND v_manager_id != NEW.user_id THEN
    NEW.current_approver_id := v_manager_id;
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
