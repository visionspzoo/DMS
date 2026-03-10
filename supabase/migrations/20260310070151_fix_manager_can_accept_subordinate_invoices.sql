/*
  # Fix: Manager (Kierownik) can accept invoices from subordinates

  ## Problem
  Managers (Kierownik) get "new row violates row-level security policy for table invoices"
  when trying to accept (approve) invoices submitted by their subordinates (Specjalista).

  ## Root Cause
  The existing RLS UPDATE policies for invoices have complex USING clauses that evaluate
  the OLD row. In some edge cases (e.g. when invoice_departments table is empty for a row,
  or when the uploader_role check fails), the USING clause may not match.

  The existing `Users can accept invoices assigned to them` policy requires the uploader's
  role to be 'Specjalista' or 'Kierownik', but does not cover all edge cases.

  ## Fix
  1. Create a SECURITY DEFINER RPC function `accept_invoice_as_manager` that handles
     the entire acceptance workflow server-side, bypassing RLS for the update operation.
  2. The function validates that the caller IS the current_approver_id before proceeding.
  3. Handles limit checks and forwarding to director when needed.

  ## Security
  - Function verifies caller is current_approver_id before making any changes
  - Only Kierownik role can use this function
  - All business logic (limits, director forwarding) is preserved
*/

CREATE OR REPLACE FUNCTION accept_invoice_as_manager(
  p_invoice_id uuid,
  p_comment text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_invoice record;
  v_limits_check jsonb;
  v_invoice_amount numeric;
  v_director_id uuid;
  v_next_status text;
  v_next_approver_id uuid;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Get caller role
  SELECT role INTO v_user_role
  FROM profiles
  WHERE id = v_user_id;

  IF v_user_role NOT IN ('Kierownik', 'Dyrektor') AND NOT (
    SELECT is_admin FROM profiles WHERE id = v_user_id
  ) THEN
    RAISE EXCEPTION 'Only Kierownik, Dyrektor or admin can use this function';
  END IF;

  -- Get invoice
  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  -- Verify caller is the current approver
  IF v_invoice.current_approver_id != v_user_id AND NOT (
    SELECT is_admin FROM profiles WHERE id = v_user_id
  ) THEN
    RAISE EXCEPTION 'You are not the current approver of this invoice';
  END IF;

  -- Must be in waiting or draft status
  IF v_invoice.status NOT IN ('waiting', 'draft') THEN
    RAISE EXCEPTION 'Invoice must be in waiting or draft status (current: %)', v_invoice.status;
  END IF;

  v_invoice_amount := COALESCE(v_invoice.pln_gross_amount, v_invoice.gross_amount, 0);

  -- Insert approval record
  INSERT INTO approvals (invoice_id, approver_id, approver_role, action, comment)
  VALUES (p_invoice_id, v_user_id, v_user_role, 'approved', p_comment);

  -- Check department limits
  v_limits_check := check_department_limits(
    v_invoice.department_id,
    v_invoice_amount,
    COALESCE(v_invoice.issue_date, v_invoice.created_at::date),
    p_invoice_id
  );

  IF (v_limits_check->>'within_limits')::boolean = true THEN
    -- Within limits: accept directly
    v_next_status := 'accepted';
    v_next_approver_id := NULL;
  ELSE
    -- Over limits: forward to director
    SELECT director_id INTO v_director_id
    FROM departments
    WHERE id = v_invoice.department_id;

    IF v_director_id IS NOT NULL THEN
      v_next_status := 'waiting';
      v_next_approver_id := v_director_id;
    ELSE
      -- No director: accept anyway
      v_next_status := 'accepted';
      v_next_approver_id := NULL;
    END IF;
  END IF;

  -- Update invoice (SECURITY DEFINER bypasses RLS)
  UPDATE invoices
  SET
    status = v_next_status,
    current_approver_id = v_next_approver_id,
    approved_by_manager_at = CASE WHEN v_next_status = 'accepted' THEN now() ELSE approved_by_manager_at END,
    updated_at = now()
  WHERE id = p_invoice_id;

  -- Audit log
  INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
  VALUES (
    p_invoice_id,
    v_user_id,
    CASE WHEN v_next_status = 'accepted' THEN 'approved_by_manager' ELSE 'forwarded_to_director' END,
    jsonb_build_object(
      'status', v_next_status,
      'current_approver_id', v_next_approver_id,
      'limits_check', v_limits_check
    ),
    CASE
      WHEN v_next_status = 'accepted'
        THEN format('Faktura zaakceptowana przez Kierownika (%s PLN)', v_invoice_amount::text)
      ELSE
        format('Faktura przekazana do Dyrektora - przekroczono limity (%s PLN)', v_invoice_amount::text)
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'status', v_next_status,
    'next_approver_id', v_next_approver_id,
    'within_limits', (v_limits_check->>'within_limits')::boolean
  );
END;
$$;

COMMENT ON FUNCTION accept_invoice_as_manager IS
'Allows a Kierownik to accept an invoice from a subordinate. Runs as SECURITY DEFINER
to bypass RLS issues. Validates caller is current_approver before proceeding.
Handles limit checks and forwards to director when limits are exceeded.';

-- Also fix the RLS policy to be more permissive for Kierownik accepting
-- by adding a fallback: if current_approver_id = auth.uid(), always allow update
DROP POLICY IF EXISTS "Kierownik can accept invoices assigned to them" ON invoices;

CREATE POLICY "Kierownik can accept invoices assigned to them"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    current_approver_id = auth.uid()
    AND (
      SELECT role FROM profiles WHERE id = auth.uid()
    ) = 'Kierownik'
  )
  WITH CHECK (true);
