/*
  # Fix get_duplicate_invoice_info to always return department name

  ## Problem
  The function uses SECURITY DEFINER so it bypasses RLS entirely.
  The v_can_access check was doing "SELECT 1 FROM invoices WHERE id = v_dup.id"
  inside a SECURITY DEFINER context which always finds the row (RLS is bypassed),
  so every duplicate was marked as accessible=true regardless of actual access.

  More importantly: users should ALWAYS see the department name of a duplicate
  even if they don't have access to that invoice. The purpose of this function
  is to inform the user that a duplicate exists somewhere in the system.

  ## Solution
  - Always include department name in results (this is the key fix requested by user)
  - Determine accessible flag by explicitly checking if the caller has access:
    * Own invoices (uploaded_by = caller)
    * Admin/CEO
    * Kierownik: uploader is Specjalista in same department_members dept
    * Dyrektor: uploader is Kierownik/Specjalista in a dept they direct
    * Non-draft: standard role-based checks via department_members
  - Always return: department_name, invoice_date, created_at, status
  - Only return id and invoice_number when accessible = true
*/

CREATE OR REPLACE FUNCTION get_duplicate_invoice_info(p_invoice_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_caller_role text;
  v_caller_is_admin boolean;
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

  SELECT role, COALESCE(is_admin, false)
  INTO v_caller_role, v_caller_is_admin
  FROM profiles
  WHERE id = v_caller_id;

  -- Verify caller can see the source invoice (they must be authenticated and it must exist)
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
      p_uploader.role AS uploader_role
    FROM invoices i
    LEFT JOIN profiles p_uploader ON p_uploader.id = i.uploaded_by
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
    -- Get department name (always available via SECURITY DEFINER)
    SELECT d.name INTO v_dept_name
    FROM departments d
    WHERE d.id = v_dup.department_id;

    -- Determine if caller can access this duplicate invoice
    v_can_access := false;

    -- CEO and admins can always access
    IF v_caller_role = 'CEO' OR v_caller_is_admin THEN
      v_can_access := true;

    -- Own invoice
    ELSIF v_dup.uploaded_by = v_caller_id THEN
      v_can_access := true;

    ELSE
      -- Check by role
      IF v_caller_role = 'Dyrektor' THEN
        -- Dyrektor can access if department is managed by them
        SELECT EXISTS (
          SELECT 1 FROM departments d
          WHERE d.id = v_dup.department_id
            AND d.director_id = v_caller_id
        ) OR EXISTS (
          SELECT 1 FROM department_members dm
          WHERE dm.user_id = v_caller_id
            AND dm.department_id = v_dup.department_id
        ) INTO v_can_access;

      ELSIF v_caller_role = 'Kierownik' THEN
        -- Kierownik can access non-draft invoices from their department
        -- For drafts: only if uploader is Specjalista in same dept
        IF v_dup.status = 'draft' THEN
          SELECT EXISTS (
            SELECT 1 FROM department_members dm_manager
            WHERE dm_manager.user_id = v_caller_id
              AND dm_manager.department_id = v_dup.department_id
          ) AND (v_dup.uploader_role = 'Specjalista') AND EXISTS (
            SELECT 1 FROM department_members dm_uploader
            WHERE dm_uploader.user_id = v_dup.uploaded_by
              AND dm_uploader.department_id = v_dup.department_id
          ) INTO v_can_access;
        ELSE
          SELECT EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.user_id = v_caller_id
              AND dm.department_id = v_dup.department_id
          ) INTO v_can_access;
        END IF;

      ELSIF v_caller_role = 'Specjalista' THEN
        -- Specjalista can access if invoice is in their department (non-draft)
        IF v_dup.status <> 'draft' THEN
          SELECT EXISTS (
            SELECT 1 FROM department_members dm
            WHERE dm.user_id = v_caller_id
              AND dm.department_id = v_dup.department_id
          ) INTO v_can_access;
        END IF;
      END IF;
    END IF;

    -- Always include the duplicate with department_name
    -- Only expose id/invoice_number when caller has access
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
