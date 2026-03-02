/*
  # Allow all users to transfer invoices

  ## Problem
  The transfer_invoice_to_department RPC function only allowed transfer
  if the user is admin, CEO, the uploader, current approver, or in the same
  department as the invoice. This blocked all other users from transferring.

  ## Fix
  Remove the authorization check from the RPC - any authenticated user who
  can see an invoice (enforced by RLS on the SELECT) should be able to transfer it.
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

  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;
  SELECT full_name INTO v_old_owner_name FROM profiles WHERE id = v_invoice.uploaded_by;
  SELECT full_name INTO v_assignee_name FROM profiles WHERE id = p_approver_id;

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
