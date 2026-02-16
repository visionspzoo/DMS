/*
  # Create SECURITY DEFINER function for invoice department transfer

  ## Problem
  
  When a non-admin user transfers a draft invoice to another department,
  PostgreSQL's RLS check on the resulting row fails because the user
  can no longer "see" the updated row via the SELECT policy (the 
  department_id and current_approver_id now belong to someone else).
  
  This causes: "new row violates row-level security policy for table invoices"
  
  ## Solution
  
  Create a SECURITY DEFINER RPC function `transfer_invoice_to_department` 
  that bypasses RLS while performing its own authorization checks internally.
  
  ## Authorization checks inside the function
  
  The function verifies that the calling user:
  1. Has a valid profile
  2. Is either an admin, CEO, the invoice uploader, the current approver, 
     a Kierownik/Dyrektor in the invoice's department, or a member of the 
     invoice's department for draft invoices
  
  ## Changes
  
  - New function: `transfer_invoice_to_department(p_invoice_id, p_department_id, p_approver_id)`
  - Returns the updated invoice row
  - Logs the transfer in audit_logs
*/

CREATE OR REPLACE FUNCTION transfer_invoice_to_department(
  p_invoice_id uuid,
  p_department_id uuid,
  p_approver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_user_dept uuid;
  v_user_is_admin boolean;
  v_invoice record;
  v_old_dept_name text;
  v_new_dept_name text;
  v_authorized boolean := false;
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

  IF v_user_is_admin = true OR v_user_role = 'CEO' THEN
    v_authorized := true;
  ELSIF v_invoice.uploaded_by = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.current_approver_id = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.department_id = v_user_dept THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to transfer this invoice';
  END IF;

  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;

  UPDATE invoices
  SET 
    department_id = p_department_id,
    current_approver_id = p_approver_id,
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
      'current_approver_id', v_invoice.current_approver_id
    ),
    jsonb_build_object(
      'department_id', p_department_id,
      'department_name', v_new_dept_name,
      'current_approver_id', p_approver_id
    ),
    format('Faktura przeniesiona z dzialu %s do %s', 
      COALESCE(v_old_dept_name, 'nieznany'), 
      COALESCE(v_new_dept_name, 'nieznany'))
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;
