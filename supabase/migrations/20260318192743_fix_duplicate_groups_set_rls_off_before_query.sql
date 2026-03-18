/*
  # Fix get_user_duplicate_invoice_groups - SET LOCAL row_security must be before all queries

  The previous version had SET LOCAL row_security = off inside an IF block,
  which in PL/pgSQL only applies within that block's scope. 
  We move it to the top level so it applies to all queries in the function.
*/

CREATE OR REPLACE FUNCTION public.get_user_duplicate_invoice_groups()
RETURNS TABLE(
  id uuid,
  invoice_number text,
  supplier_name text,
  supplier_nip text,
  issue_date date,
  due_date date,
  net_amount numeric,
  tax_amount numeric,
  gross_amount numeric,
  pln_gross_amount numeric,
  exchange_rate numeric,
  currency text,
  status text,
  description text,
  uploaded_by uuid,
  uploader_name text,
  uploader_role text,
  current_approver_id uuid,
  department_id uuid,
  department_name text,
  cost_center_id uuid,
  file_url text,
  paid_at timestamptz,
  paid_by uuid,
  created_at timestamptz,
  updated_at timestamptz,
  source text,
  is_duplicate boolean,
  duplicate_invoice_ids uuid[],
  file_hash text,
  user_drive_file_id text,
  drive_owner_user_id uuid,
  pz_number text,
  bez_mpk boolean,
  internal_comment text
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
SET row_security TO off
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  SELECT p.is_admin INTO v_is_admin FROM profiles p WHERE p.id = v_caller_id;
  v_is_admin := COALESCE(v_is_admin, false);

  IF v_is_admin THEN
    -- Admins see all duplicate groups
    RETURN QUERY
    WITH all_keyed AS (
      SELECT
        i.id AS inv_id,
        CASE WHEN i.supplier_nip IS NOT NULL AND i.supplier_nip <> ''
        THEN regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') || '__' || i.invoice_number
        ELSE 'name__' || lower(trim(COALESCE(i.supplier_name, ''))) || '__' || i.invoice_number
        END AS grp_key
      FROM invoices i
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    dup_keys AS (
      SELECT ak.grp_key FROM all_keyed ak GROUP BY ak.grp_key HAVING count(*) >= 2
    ),
    dup_ids AS (
      SELECT DISTINCT ak.inv_id FROM all_keyed ak INNER JOIN dup_keys dk ON ak.grp_key = dk.grp_key
    )
    SELECT
      av.id, av.invoice_number, av.supplier_name, av.supplier_nip,
      av.issue_date, av.due_date, av.net_amount, av.tax_amount, av.gross_amount,
      av.pln_gross_amount, av.exchange_rate, av.currency, av.status,
      av.description, av.uploaded_by,
      p.full_name, p.role,
      av.current_approver_id, av.department_id,
      d.name, av.cost_center_id,
      av.file_url, av.paid_at, av.paid_by, av.created_at, av.updated_at,
      av.source, av.is_duplicate,
      (av.duplicate_invoice_ids)::uuid[],
      av.file_hash, av.user_drive_file_id, av.drive_owner_user_id,
      av.pz_number, av.bez_mpk, av.internal_comment
    FROM invoices av
    LEFT JOIN profiles p ON p.id = av.uploaded_by
    LEFT JOIN departments d ON d.id = av.department_id
    WHERE av.id IN (SELECT di.inv_id FROM dup_ids di);

  ELSE
    -- Non-admin: show duplicate groups where user is personally involved
    -- (uploaded_by or current_approver_id) in at least one invoice of the group.
    -- Show all accessible invoices from those groups (own + department).
    RETURN QUERY
    WITH
    all_keyed AS (
      SELECT
        i.id AS inv_id,
        CASE WHEN i.supplier_nip IS NOT NULL AND i.supplier_nip <> ''
        THEN regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') || '__' || i.invoice_number
        ELSE 'name__' || lower(trim(COALESCE(i.supplier_name, ''))) || '__' || i.invoice_number
        END AS grp_key
      FROM invoices i
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    user_owned_keys AS (
      SELECT DISTINCT ak.grp_key
      FROM all_keyed ak
      INNER JOIN invoices i ON i.id = ak.inv_id
      WHERE i.uploaded_by = v_caller_id
         OR i.current_approver_id = v_caller_id
    ),
    dup_keys AS (
      SELECT ak.grp_key
      FROM all_keyed ak
      INNER JOIN user_owned_keys uok ON ak.grp_key = uok.grp_key
      GROUP BY ak.grp_key
      HAVING count(*) >= 2
    ),
    accessible_dup_ids AS (
      SELECT DISTINCT ak.inv_id
      FROM all_keyed ak
      INNER JOIN dup_keys dk ON ak.grp_key = dk.grp_key
      INNER JOIN invoices i ON i.id = ak.inv_id
      LEFT JOIN department_members dm ON dm.department_id = i.department_id AND dm.user_id = v_caller_id
      WHERE i.uploaded_by = v_caller_id
         OR i.current_approver_id = v_caller_id
         OR dm.user_id IS NOT NULL
    )
    SELECT
      av.id, av.invoice_number, av.supplier_name, av.supplier_nip,
      av.issue_date, av.due_date, av.net_amount, av.tax_amount, av.gross_amount,
      av.pln_gross_amount, av.exchange_rate, av.currency, av.status,
      av.description, av.uploaded_by,
      p.full_name, p.role,
      av.current_approver_id, av.department_id,
      d.name, av.cost_center_id,
      av.file_url, av.paid_at, av.paid_by, av.created_at, av.updated_at,
      av.source, av.is_duplicate,
      (av.duplicate_invoice_ids)::uuid[],
      av.file_hash, av.user_drive_file_id, av.drive_owner_user_id,
      av.pz_number, av.bez_mpk, av.internal_comment
    FROM invoices av
    LEFT JOIN profiles p ON p.id = av.uploaded_by
    LEFT JOIN departments d ON d.id = av.department_id
    WHERE av.id IN (SELECT di.inv_id FROM accessible_dup_ids di);
  END IF;
END;
$$;
