/*
  # Fix get_duplicate_invoice_info - use correct column name issue_date

  The invoices table uses `issue_date` not `invoice_date`.
  This caused the function to fail with a column not found error,
  resulting in admins (and all users) seeing no duplicate warnings.
*/

CREATE OR REPLACE FUNCTION get_duplicate_invoice_info(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_is_admin boolean;
  v_caller_role text;
  v_invoice record;
  v_duplicates jsonb := '[]'::jsonb;
  v_dup record;
  v_dept_name text;
  v_can_access boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT is_admin, role
  INTO v_caller_is_admin, v_caller_role
  FROM profiles
  WHERE id = v_caller_id;

  SELECT id, invoice_number, supplier_nip, supplier_name, department_id
  INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF NOT v_caller_is_admin AND v_caller_role <> 'CEO' THEN
    IF NOT EXISTS (
      SELECT 1 FROM department_members
      WHERE user_id = v_caller_id AND department_id = v_invoice.department_id
    ) AND NOT EXISTS (
      SELECT 1 FROM invoices i2
      WHERE i2.id = p_invoice_id
        AND (i2.uploaded_by = v_caller_id OR i2.current_approver_id = v_caller_id)
    ) THEN
      RETURN jsonb_build_object('error', 'not_found');
    END IF;
  END IF;

  IF v_invoice.invoice_number IS NULL THEN
    RETURN jsonb_build_object('duplicates', '[]'::jsonb, 'total_count', 0);
  END IF;

  FOR v_dup IN
    SELECT
      i.id,
      i.invoice_number,
      i.issue_date,
      i.created_at,
      i.department_id,
      i.supplier_nip,
      i.supplier_name,
      i.status
    FROM invoices i
    WHERE i.id <> p_invoice_id
      AND i.invoice_number = v_invoice.invoice_number
      AND (
        (v_invoice.supplier_nip IS NOT NULL AND v_invoice.supplier_nip <> ''
          AND regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') = regexp_replace(v_invoice.supplier_nip, '[^0-9]', '', 'g'))
        OR
        ((v_invoice.supplier_nip IS NULL OR v_invoice.supplier_nip = '')
          AND v_invoice.supplier_name IS NOT NULL
          AND lower(i.supplier_name) = lower(v_invoice.supplier_name))
      )
  LOOP
    SELECT d.name INTO v_dept_name
    FROM departments d
    WHERE d.id = v_dup.department_id;

    IF v_caller_is_admin OR v_caller_role = 'CEO' THEN
      v_can_access := true;
    ELSE
      SELECT EXISTS (
        SELECT 1 FROM department_members
        WHERE user_id = v_caller_id AND department_id = v_dup.department_id
      ) OR EXISTS (
        SELECT 1 FROM invoices i3
        WHERE i3.id = v_dup.id
          AND (i3.uploaded_by = v_caller_id OR i3.current_approver_id = v_caller_id)
      ) INTO v_can_access;
    END IF;

    IF v_can_access THEN
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'id', v_dup.id,
        'invoice_number', v_dup.invoice_number,
        'invoice_date', v_dup.issue_date,
        'created_at', v_dup.created_at,
        'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
        'status', v_dup.status,
        'accessible', true
      ));
    ELSE
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'invoice_date', v_dup.issue_date,
        'created_at', v_dup.created_at,
        'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
        'accessible', false
      ));
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'duplicates', v_duplicates,
    'total_count', jsonb_array_length(v_duplicates)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_duplicate_invoice_info(uuid) TO authenticated;
