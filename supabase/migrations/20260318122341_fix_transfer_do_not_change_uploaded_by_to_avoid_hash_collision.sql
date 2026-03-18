/*
  # Fix transfer_invoice_to_department: do not change uploaded_by

  ## Problem
  When transferring an invoice, the function was setting `uploaded_by = p_approver_id`.
  If the target user already has an invoice with the same file_hash (e.g. received the
  same PDF via email), this violates the unique constraint
  `idx_invoices_file_hash_per_user (file_hash, uploaded_by)`.

  ## Fix
  Remove the `uploaded_by` update from the transfer function. The original uploader stays
  unchanged. Visibility and approval routing are controlled by `department_id` and
  `current_approver_id`, so this change does not affect the workflow.
*/

CREATE OR REPLACE FUNCTION public.transfer_invoice_to_department(
  p_invoice_id uuid,
  p_department_id uuid,
  p_approver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'auth', 'extensions'
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
    RAISE EXCEPTION 'Invoice not found: %', p_invoice_id;
  END IF;

  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;
  SELECT full_name INTO v_old_owner_name FROM profiles WHERE id = v_invoice.uploaded_by;
  SELECT full_name INTO v_assignee_name FROM profiles WHERE id = p_approver_id;

  UPDATE invoices
  SET
    department_id = p_department_id,
    current_approver_id = p_approver_id,
    status = 'draft',
    updated_at = now()
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Failed to update invoice: %', p_invoice_id;
  END IF;

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
      'current_approver_id', p_approver_id,
      'owner_name', v_assignee_name
    ),
    format('Faktura przekazana z działu %s do %s (przypisana do: %s)',
      COALESCE(v_old_dept_name, 'nieznany'),
      COALESCE(v_new_dept_name, 'nieznany'),
      COALESCE(v_assignee_name, 'nieznany'))
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'from_department', v_old_dept_name,
    'to_department', v_new_dept_name,
    'assignee', v_assignee_name
  );
END;
$$;
