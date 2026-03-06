/*
  # Fix get_duplicate_invoice_info - Use Correct Column Name issue_date

  ## Problem
  The function referenced `invoice_date` which does not exist.
  The correct column name is `issue_date`.

  ## Fix
  Replace all references to invoice_date with issue_date in the function body.
*/

CREATE OR REPLACE FUNCTION get_duplicate_invoice_info(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invoice record;
  v_duplicates jsonb := '[]'::jsonb;
  v_dup record;
  v_dept_name text;
  v_uploaded_by_name text;
  v_approver_name text;
BEGIN
  SELECT id, invoice_number, supplier_nip, supplier_name, department_id
  INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('duplicates', '[]'::jsonb, 'total_count', 0);
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
      i.status,
      i.uploaded_by,
      i.current_approver_id
    FROM invoices i
    WHERE i.id <> p_invoice_id
      AND i.invoice_number = v_invoice.invoice_number
      AND (
        (v_invoice.supplier_nip IS NOT NULL AND v_invoice.supplier_nip <> ''
          AND regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') = regexp_replace(v_invoice.supplier_nip, '[^0-9]', '', 'g'))
        OR
        (
          (v_invoice.supplier_nip IS NULL OR v_invoice.supplier_nip = '')
          AND v_invoice.supplier_name IS NOT NULL
          AND lower(i.supplier_name) = lower(v_invoice.supplier_name)
        )
      )
  LOOP
    SELECT d.name INTO v_dept_name
    FROM departments d
    WHERE d.id = v_dup.department_id;

    SELECT COALESCE(p.full_name, p.email, 'Nieznany')
    INTO v_uploaded_by_name
    FROM profiles p
    WHERE p.id = v_dup.uploaded_by;

    v_approver_name := NULL;
    IF v_dup.current_approver_id IS NOT NULL THEN
      SELECT COALESCE(p.full_name, p.email, 'Nieznany')
      INTO v_approver_name
      FROM profiles p
      WHERE p.id = v_dup.current_approver_id;
    END IF;

    v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
      'id', v_dup.id,
      'invoice_number', v_dup.invoice_number,
      'invoice_date', v_dup.issue_date,
      'created_at', v_dup.created_at,
      'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
      'status', v_dup.status,
      'uploaded_by_name', COALESCE(v_uploaded_by_name, 'Nieznany'),
      'current_approver_name', v_approver_name,
      'accessible', true
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'duplicates', v_duplicates,
    'total_count', jsonb_array_length(v_duplicates)
  );
END;
$$;

GRANT EXECUTE ON FUNCTION get_duplicate_invoice_info(uuid) TO authenticated;
