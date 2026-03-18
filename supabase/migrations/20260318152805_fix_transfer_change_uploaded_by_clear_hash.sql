/*
  # Fix transfer_invoice_to_department: change uploaded_by AND clear file_hash

  ## Problem
  The transfer function stopped changing `uploaded_by` because the unique index
  `idx_invoices_file_hash_per_user (file_hash, uploaded_by)` caused a conflict
  when the target user already had an invoice with the same file_hash.

  ## Solution
  When transferring an invoice:
  1. Change `uploaded_by` to the selected assignee (p_approver_id) — this is the
     user's explicit intent when choosing who to forward the invoice to.
  2. Clear `file_hash` (set to NULL) so the unique constraint is never triggered.
     Duplicate detection via hash is irrelevant after a transfer: the receiving
     user is getting the invoice explicitly, not uploading a new one.

  ## Rule (final, do not change)
  - `uploaded_by` ALWAYS changes on transfer to reflect the new owner/assignee
  - `file_hash` is cleared on transfer to avoid unique constraint conflicts
  - `current_approver_id` is set to the selected approver
  - `department_id` is updated to the target department
  - Status is reset to 'draft'
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

  -- Update invoice:
  -- 1. Change department and approver
  -- 2. Change uploaded_by (owner) to the new assignee — user's explicit choice
  -- 3. Clear file_hash to avoid unique constraint conflict on (file_hash, uploaded_by)
  -- 4. Reset status to draft
  UPDATE invoices
  SET
    department_id = p_department_id,
    current_approver_id = p_approver_id,
    uploaded_by = p_approver_id,
    file_hash = NULL,
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
      'uploaded_by', p_approver_id,
      'owner_name', v_assignee_name
    ),
    format('Faktura przekazana z działu %s (właściciel: %s) do %s (nowy właściciel: %s)',
      COALESCE(v_old_dept_name, 'nieznany'),
      COALESCE(v_old_owner_name, 'nieznany'),
      COALESCE(v_new_dept_name, 'nieznany'),
      COALESCE(v_assignee_name, 'nieznany'))
  );

  RETURN jsonb_build_object(
    'success', true,
    'invoice_id', p_invoice_id,
    'from_department', v_old_dept_name,
    'to_department', v_new_dept_name,
    'new_owner', v_assignee_name
  );
END;
$$;
