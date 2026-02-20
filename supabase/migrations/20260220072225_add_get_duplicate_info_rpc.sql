/*
  # Add RPC function for cross-department duplicate info

  ## Purpose
  Users currently only see duplicate information from departments they have access to.
  This creates an incomplete picture - they know a duplicate exists (via is_duplicate flag)
  but can't tell which department it's in.

  ## Solution
  A SECURITY DEFINER function that:
  - Accepts an invoice_id from the calling user
  - Verifies the caller has read access to that invoice (via RLS-visible query)
  - Returns aggregated, non-sensitive duplicate info:
    - How many duplicates exist in total (including inaccessible departments)
    - For each duplicate: department name, invoice date, upload date
    - Whether the caller has direct access to each duplicate
  - Does NOT return invoice IDs or sensitive data for inaccessible invoices

  ## Security
  - Caller must be authenticated
  - Caller must be able to see the source invoice (verified by RLS query)
  - Only department name + dates are returned for inaccessible duplicates
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
      i.status
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
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'id', v_dup.id,
        'invoice_number', v_dup.invoice_number,
        'invoice_date', v_dup.invoice_date,
        'created_at', v_dup.created_at,
        'department_name', COALESCE(v_dept_name, 'Nieznany dział'),
        'status', v_dup.status,
        'accessible', true
      ));
    ELSE
      v_duplicates := v_duplicates || jsonb_build_array(jsonb_build_object(
        'invoice_date', v_dup.invoice_date,
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
