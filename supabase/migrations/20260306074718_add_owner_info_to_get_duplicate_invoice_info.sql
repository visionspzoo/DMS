/*
  # Add Owner and Status Info to get_duplicate_invoice_info RPC

  ## Changes
  Updates the `get_duplicate_invoice_info` function to also return:
  - `uploaded_by_name`: full name (or email) of the person who uploaded/owns the invoice
  - `current_approver_name`: full name (or email) of the person currently responsible
  - `status`: already returned for accessible, now also returned for inaccessible duplicates

  ## Security
  - Owner names are returned only for accessible duplicates (caller has RLS access)
  - For inaccessible duplicates: only department name, dates and status are shown (no PII)
*/

CREATE OR REPLACE FUNCTION get_duplicate_invoice_info(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_invoice record;
  v_result jsonb;
  v_duplicates jsonb := '[]'::jsonb;
  v_dup record;
  v_dept_name text;
  v_can_access boolean;
  v_uploaded_by_name text;
  v_approver_name text;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('error', 'not_authenticated');
  END IF;

  SELECT id, invoice_number, supplier_nip, supplier_name, department_id
  INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'not_found');
  END IF;

  IF v_invoice.invoice_number IS NULL THEN
    RETURN jsonb_build_object('duplicates', '[]'::jsonb, 'total_count', 0);
  END IF;

  FOR v_dup IN
    SELECT
      i.id,
      i.invoice_number,
      i.invoice_date,
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
        (v_invoice.supplier_nip IS NULL OR v_invoice.supplier_nip = '')
        AND v_invoice.supplier_name IS NOT NULL
        AND lower(i.supplier_name) = lower(v_invoice.supplier_name)
      )
  LOOP
    SELECT d.name INTO v_dept_name
    FROM departments d
    WHERE d.id = v_dup.department_id;

    SELECT EXISTS (
      SELECT 1 FROM invoices visible
      WHERE visible.id = v_dup.id
    ) INTO v_can_access;

    IF v_can_access THEN
      -- Resolve uploaded_by name
      SELECT COALESCE(p.full_name, p.email, 'Nieznany')
      INTO v_uploaded_by_name
      FROM profiles p
      WHERE p.id = v_dup.uploaded_by;

      -- Resolve current_approver name
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
        'invoice_date', v_dup.invoice_date,
        'created_at', v_dup.created_at,
        'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
        'status', v_dup.status,
        'uploaded_by_name', COALESCE(v_uploaded_by_name, 'Nieznany'),
        'current_approver_name', v_approver_name,
        'accessible', true
      ));
    ELSE
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'invoice_date', v_dup.invoice_date,
        'created_at', v_dup.created_at,
        'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
        'status', v_dup.status,
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
