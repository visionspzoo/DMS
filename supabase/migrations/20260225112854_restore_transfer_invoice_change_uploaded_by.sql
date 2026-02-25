/*
  # Restore transfer_invoice_to_department - change uploaded_by on department transfer

  ## Rule
  uploaded_by (owner) SHOULD change when:
  1. Invoice is transferred to another department ("Prześlij do innego działu")
  2. KSEF invoice transferred to a user
  3. Initial invoice upload

  It should NEVER change during approval workflow actions.
*/

CREATE OR REPLACE FUNCTION transfer_invoice_to_department(
  p_invoice_id uuid,
  p_department_id uuid,
  p_approver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_user_dept uuid;
  v_user_is_admin boolean;
  v_invoice record;
  v_old_dept_name text;
  v_new_dept_name text;
  v_old_owner_name text;
  v_assignee_name text;
BEGIN
  v_user_id := auth.uid();

  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, department_id, is_admin
  INTO v_user_role, v_user_dept, v_user_is_admin
  FROM profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF NOT (
    v_user_is_admin = true OR
    v_user_role = 'CEO' OR
    v_invoice.uploaded_by = v_user_id OR
    v_invoice.current_approver_id = v_user_id OR
    v_invoice.department_id = v_user_dept
  ) THEN
    RAISE EXCEPTION 'Not authorized to transfer this invoice';
  END IF;

  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;
  SELECT full_name INTO v_old_owner_name FROM profiles WHERE id = v_invoice.uploaded_by;
  SELECT full_name INTO v_assignee_name FROM profiles WHERE id = p_approver_id;

  -- Update invoice: change department, approver AND owner (uploaded_by)
  UPDATE invoices
  SET
    department_id = p_department_id,
    current_approver_id = p_approver_id,
    uploaded_by = p_approver_id,
    status = 'draft',
    updated_at = now()
  WHERE id = p_invoice_id;

  INSERT INTO audit_logs (
    invoice_id,
    user_id,
    action,
    old_values,
    new_values,
    description
  ) VALUES (
    p_invoice_id,
    v_user_id,
    'transferred_to_department',
    jsonb_build_object(
      'department_id', v_invoice.department_id,
      'department_name', v_old_dept_name,
      'uploaded_by', v_invoice.uploaded_by,
      'owner_name', v_old_owner_name
    ),
    jsonb_build_object(
      'department_id', p_department_id,
      'department_name', v_new_dept_name,
      'uploaded_by', p_approver_id,
      'owner_name', v_assignee_name
    ),
    format('Faktura przekazana z działu %s do %s (nowy właściciel: %s)',
      COALESCE(v_old_dept_name, 'nieznany'),
      COALESCE(v_new_dept_name, 'nieznany'),
      COALESCE(v_assignee_name, 'nieznany'))
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;
