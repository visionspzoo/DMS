/*
  # Purchase Request Approval Workflow

  ## Overview
  Full approval workflow for purchase requests, independent of invoice flow.

  ## New Tables
  - `purchase_request_approvals` - tracks approval steps per request
  - `purchase_request_limits` - per-user monthly and single-item limits for auto-approval

  ## Changes to purchase_requests
  - Add `current_approver_id` - who needs to act next
  - Add `approver_comment` - latest comment
  - Add `submitted_at` - when submitted

  ## Security
  - RLS enabled on all new tables
*/

-- -------------------------------------------------------
-- 1. Add columns to purchase_requests FIRST
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'current_approver_id'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN current_approver_id uuid REFERENCES auth.users(id) ON DELETE SET NULL;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'approver_comment'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN approver_comment text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'submitted_at'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN submitted_at timestamptz;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_current_approver ON purchase_requests(current_approver_id);

-- -------------------------------------------------------
-- 2. RLS policies on purchase_requests for approvers
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_requests' AND policyname = 'Current approver can update request'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Current approver can update request"
        ON purchase_requests FOR UPDATE
        TO authenticated
        USING (current_approver_id = auth.uid())
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'purchase_requests' AND policyname = 'Current approver can view assigned requests'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Current approver can view assigned requests"
        ON purchase_requests FOR SELECT
        TO authenticated
        USING (current_approver_id = auth.uid())
    $policy$;
  END IF;
END $$;

-- -------------------------------------------------------
-- 3. purchase_request_approvals table
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_request_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id uuid NOT NULL REFERENCES purchase_requests(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'manager',
  action text NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_request_approvals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Approvers can insert own approvals"
  ON purchase_request_approvals FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = approver_id);

CREATE POLICY "Request owner can view approvals"
  ON purchase_request_approvals FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM purchase_requests pr
      WHERE pr.id = purchase_request_approvals.purchase_request_id
        AND pr.user_id = auth.uid()
    )
    OR auth.uid() = approver_id
    OR EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_pr_approvals_request_id ON purchase_request_approvals(purchase_request_id);
CREATE INDEX IF NOT EXISTS idx_pr_approvals_approver_id ON purchase_request_approvals(approver_id);

-- -------------------------------------------------------
-- 4. purchase_request_limits table
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_request_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  monthly_limit numeric(12,2),
  single_limit numeric(12,2),
  set_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id)
);

ALTER TABLE purchase_request_limits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own purchase limits"
  ON purchase_request_limits FOR SELECT
  TO authenticated
  USING (
    auth.uid() = user_id
    OR EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.role IN ('Kierownik', 'Dyrektor'))
    )
  );

CREATE POLICY "Managers and admins can insert purchase limits"
  ON purchase_request_limits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.role IN ('Kierownik', 'Dyrektor'))
    )
  );

CREATE POLICY "Managers and admins can update purchase limits"
  ON purchase_request_limits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.role IN ('Kierownik', 'Dyrektor'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.role IN ('Kierownik', 'Dyrektor'))
    )
  );

CREATE POLICY "Managers and admins can delete purchase limits"
  ON purchase_request_limits FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid()
        AND (profiles.is_admin = true OR profiles.role IN ('Kierownik', 'Dyrektor'))
    )
  );

CREATE INDEX IF NOT EXISTS idx_pr_limits_user_id ON purchase_request_limits(user_id);

-- -------------------------------------------------------
-- 5. Trigger: assign initial approver on insert
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
  v_manager_limit numeric;
  v_director_limit numeric;
  v_amount numeric;
BEGIN
  v_amount := COALESCE(NEW.gross_amount, 0);

  -- Target department
  v_dept_id := NEW.department_id;
  IF v_dept_id IS NULL THEN
    SELECT department_id INTO v_dept_id FROM profiles WHERE id = NEW.user_id;
  END IF;

  IF v_dept_id IS NOT NULL THEN
    SELECT manager_id, director_id INTO v_manager_id, v_director_id
    FROM departments WHERE id = v_dept_id;
  END IF;

  -- Check manager single_limit
  IF v_manager_id IS NOT NULL THEN
    SELECT single_limit INTO v_manager_limit
    FROM purchase_request_limits WHERE user_id = v_manager_id;
  END IF;

  -- Check director single_limit
  IF v_director_id IS NOT NULL THEN
    SELECT single_limit INTO v_director_limit
    FROM purchase_request_limits WHERE user_id = v_director_id;
  END IF;

  -- Determine initial approver
  IF v_manager_id IS NOT NULL AND (v_manager_limit IS NULL OR v_amount > v_manager_limit) THEN
    -- Needs manager approval
    NEW.current_approver_id := v_manager_id;
  ELSIF v_director_id IS NOT NULL AND (v_director_limit IS NULL OR v_amount > v_director_limit) THEN
    -- Manager limit covers it, but director limit doesn't
    NEW.current_approver_id := v_director_id;
  ELSE
    -- Both limits cover it, or no approvers → auto-approve
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
-- 6. RPC: process_purchase_request_approval
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
  v_director_limit numeric;
  v_amount numeric;
  v_is_admin boolean;
BEGIN
  SELECT * INTO v_request FROM purchase_requests WHERE id = p_request_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Request not found');
  END IF;

  SELECT role, is_admin INTO v_approver_role, v_is_admin FROM profiles WHERE id = auth.uid();

  IF v_request.current_approver_id != auth.uid() AND NOT v_is_admin THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  INSERT INTO purchase_request_approvals(purchase_request_id, approver_id, role, action, comment)
  VALUES (p_request_id, auth.uid(), v_approver_role, p_action, p_comment);

  IF p_action = 'rejected' THEN
    UPDATE purchase_requests
    SET status = 'rejected', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('success', true, 'status', 'rejected');
  END IF;

  -- Approved path: check if director also needs to approve
  v_dept_id := v_request.department_id;
  v_amount := COALESCE(v_request.gross_amount, 0);

  IF v_dept_id IS NOT NULL THEN
    SELECT director_id INTO v_director_id FROM departments WHERE id = v_dept_id;
  END IF;

  IF v_approver_role = 'Kierownik' AND v_director_id IS NOT NULL AND v_director_id != auth.uid() THEN
    SELECT single_limit INTO v_director_limit
    FROM purchase_request_limits WHERE user_id = v_director_id;

    IF v_director_limit IS NULL OR (v_amount > 0 AND v_amount > v_director_limit) THEN
      UPDATE purchase_requests
      SET current_approver_id = v_director_id, approver_comment = p_comment, updated_at = now()
      WHERE id = p_request_id;
      RETURN jsonb_build_object('success', true, 'status', 'waiting_director');
    END IF;
  END IF;

  UPDATE purchase_requests
  SET status = 'approved', current_approver_id = NULL, approver_comment = p_comment, updated_at = now()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('success', true, 'status', 'approved');
END;
$$;

GRANT EXECUTE ON FUNCTION process_purchase_request_approval(uuid, text, text) TO authenticated;

-- -------------------------------------------------------
-- 7. RPC: get_purchase_requests_for_approval
-- Returns requests where current_approver_id = caller
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
  proforma_filename text
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
    pr.proforma_filename
  FROM purchase_requests pr
  LEFT JOIN profiles p ON p.id = pr.user_id
  LEFT JOIN departments d ON d.id = pr.department_id
  WHERE pr.current_approver_id = auth.uid()
  ORDER BY pr.submitted_at ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_purchase_requests_for_approval() TO authenticated;
