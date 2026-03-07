/*
  # Add specialist auto-approve limit for purchase requests

  ## Summary
  Adds a per-specialist auto-approve threshold: if a specialist's purchase request
  amount is at or below their `auto_approve_limit`, the request is automatically
  approved without needing manager (Kierownik) approval.

  ## Changes
  - Adds `auto_approve_limit` column to `purchase_request_limits` table
    (nullable numeric — NULL means no auto-approval, must go to manager)
  - Rewrites `assign_purchase_request_approver` trigger to check this limit:
    if amount <= specialist's auto_approve_limit → auto-approve immediately
  - Only applies to Specialist-role users; manager/director flow unchanged

  ## Security
  - Existing RLS policies on `purchase_request_limits` remain in place
  - Managers (Kierownik) can set this limit for their subordinates via existing policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_request_limits' AND column_name = 'auto_approve_limit'
  ) THEN
    ALTER TABLE purchase_request_limits
      ADD COLUMN auto_approve_limit numeric(12,2) DEFAULT NULL;
  END IF;
END $$;

-- Rewrite the trigger to respect specialist auto_approve_limit
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

  -- For Specialist role: check if their auto_approve_limit covers this amount
  IF v_submitter_role = 'Specjalista' THEN
    SELECT auto_approve_limit INTO v_auto_approve_limit
    FROM purchase_request_limits
    WHERE user_id = NEW.user_id;

    IF v_auto_approve_limit IS NOT NULL AND v_amount <= v_auto_approve_limit THEN
      -- Auto-approve: amount is within the specialist's auto-approve limit
      NEW.status := 'approved';
      NEW.current_approver_id := NULL;
      NEW.submitted_at := now();
      RETURN NEW;
    END IF;
  END IF;

  -- Standard routing: manager → director
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
