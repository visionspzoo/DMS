/*
  # Create direct_approve_invoice RPC

  ## Purpose
  Allows a Kierownik or Dyrektor to directly approve a draft invoice
  belonging to their subordinate, bypassing RLS issues that occur when
  invoice_departments is out of sync or current_approver_id is null.

  The function:
  1. Validates caller is Kierownik/Dyrektor with access to the invoice's department
  2. Inserts approval records for all relevant parties
  3. Checks department/director limits
  4. Updates invoice status to 'accepted' or 'waiting' (if limits exceeded)
  5. Logs audit trail

  Security: SECURITY DEFINER bypasses RLS for all internal operations.
*/

CREATE OR REPLACE FUNCTION direct_approve_invoice(
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
  v_is_admin boolean;
  v_invoice record;
  v_department record;
  v_uploader_role text;
  v_limits_check jsonb;
  v_director_limits_check jsonb;
  v_invoice_amount numeric;
  v_new_status text;
  v_next_approver_id uuid;
  v_ceo_id uuid;
  v_can_approve boolean := false;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, is_admin INTO v_user_role, v_is_admin
  FROM profiles
  WHERE id = v_user_id;

  IF v_user_role NOT IN ('Kierownik', 'Dyrektor') AND v_is_admin != true THEN
    RAISE EXCEPTION 'Only Kierownik, Dyrektor or admin can use this function';
  END IF;

  SELECT * INTO v_invoice FROM invoices WHERE id = p_invoice_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  IF v_invoice.status != 'draft' THEN
    RAISE EXCEPTION 'Invoice must be in draft status (current: %)', v_invoice.status;
  END IF;

  SELECT role INTO v_uploader_role FROM profiles WHERE id = v_invoice.uploaded_by;

  SELECT * INTO v_department FROM departments WHERE id = v_invoice.department_id;

  -- Verify access
  IF v_is_admin = true THEN
    v_can_approve := true;
  ELSIF v_user_role = 'Kierownik' THEN
    -- Manager can approve if they manage this department and uploader is subordinate
    IF (v_department.manager_id = v_user_id OR EXISTS (
          SELECT 1 FROM department_members dm
          WHERE dm.user_id = v_user_id AND dm.department_id = v_invoice.department_id
        ))
       AND v_uploader_role = 'Specjalista'
       AND v_invoice.uploaded_by != v_user_id THEN
      v_can_approve := true;
    END IF;
  ELSIF v_user_role = 'Dyrektor' THEN
    IF (v_department.director_id = v_user_id OR EXISTS (
          SELECT 1 FROM department_members dm
          WHERE dm.user_id = v_user_id AND dm.department_id = v_invoice.department_id
        ))
       AND v_uploader_role IN ('Specjalista', 'Kierownik')
       AND v_invoice.uploaded_by != v_user_id THEN
      v_can_approve := true;
    END IF;
  END IF;

  IF v_can_approve = false THEN
    RAISE EXCEPTION 'You do not have permission to directly approve this invoice';
  END IF;

  v_invoice_amount := COALESCE(v_invoice.pln_gross_amount, v_invoice.gross_amount, 0);

  -- Insert approval records
  IF v_user_role = 'Kierownik' OR v_is_admin = true THEN
    IF v_uploader_role = 'Specjalista' THEN
      INSERT INTO approvals (invoice_id, approver_id, approver_role, action, comment)
      VALUES (p_invoice_id, v_user_id, COALESCE(v_user_role, 'Admin'), 'approved',
              COALESCE(p_comment, 'Bezpośrednia akceptacja przez Kierownika'));
    END IF;
  END IF;

  IF v_user_role = 'Dyrektor' THEN
    IF v_uploader_role = 'Specjalista' AND v_department.manager_id IS NOT NULL THEN
      INSERT INTO approvals (invoice_id, approver_id, approver_role, action, comment)
      VALUES (p_invoice_id, v_department.manager_id, 'Kierownik', 'approved',
              format('Automatycznie zaakceptowane przez Dyrektora %s',
                     (SELECT full_name FROM profiles WHERE id = v_user_id)));
    END IF;
    INSERT INTO approvals (invoice_id, approver_id, approver_role, action, comment)
    VALUES (p_invoice_id, v_user_id, 'Dyrektor', 'approved',
            COALESCE(p_comment, 'Bezpośrednia akceptacja przez Dyrektora'));
  END IF;

  -- Determine new status based on limits
  v_new_status := 'accepted';
  v_next_approver_id := NULL;

  IF v_user_role = 'Kierownik' THEN
    v_limits_check := check_department_limits(
      v_invoice.department_id,
      v_invoice_amount,
      COALESCE(v_invoice.issue_date, v_invoice.created_at::date),
      p_invoice_id
    );

    IF (v_limits_check->>'within_limits')::boolean = false THEN
      IF v_department.director_id IS NOT NULL THEN
        v_new_status := 'waiting';
        v_next_approver_id := v_department.director_id;
      END IF;
    END IF;

  ELSIF v_user_role = 'Dyrektor' THEN
    SELECT id INTO v_ceo_id FROM profiles WHERE role = 'CEO' LIMIT 1;

    IF v_ceo_id IS NOT NULL THEN
      v_director_limits_check := check_director_limits(
        v_user_id,
        v_invoice_amount,
        COALESCE(v_invoice.issue_date, v_invoice.created_at::date),
        p_invoice_id
      );

      IF (v_director_limits_check->>'within_limits')::boolean = false THEN
        v_new_status := 'waiting';
        v_next_approver_id := v_ceo_id;
      END IF;
    END IF;
  END IF;

  -- Update invoice
  UPDATE invoices
  SET
    status = v_new_status,
    current_approver_id = v_next_approver_id,
    approved_by_manager_at = CASE
      WHEN v_user_role IN ('Kierownik') AND v_new_status = 'accepted' THEN now()
      ELSE approved_by_manager_at
    END,
    approved_by_director_at = CASE
      WHEN v_user_role = 'Dyrektor' AND v_new_status = 'accepted' THEN now()
      ELSE approved_by_director_at
    END,
    updated_at = now()
  WHERE id = p_invoice_id;

  -- Audit log
  INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
  VALUES (
    p_invoice_id,
    v_user_id,
    CASE WHEN v_new_status = 'accepted' THEN 'direct_approved' ELSE 'direct_approved_forwarded' END,
    jsonb_build_object(
      'status', v_new_status,
      'next_approver_id', v_next_approver_id,
      'approver_role', v_user_role
    ),
    CASE
      WHEN v_new_status = 'accepted'
        THEN format('Faktura zaakceptowana bezpośrednio przez %s (%s PLN)',
                    v_user_role, v_invoice_amount)
      ELSE format('Faktura zaakceptowana przez %s i przekazana dalej (%s PLN)',
                    v_user_role, v_invoice_amount)
    END
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'status', v_new_status,
    'next_approver_id', v_next_approver_id
  );
END;
$$;
