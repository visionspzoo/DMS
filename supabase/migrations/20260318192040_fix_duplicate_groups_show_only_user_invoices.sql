/*
  # Fix get_user_duplicate_invoice_groups - show only user's own accessible invoices

  Previously, for non-admin users, the function was:
  1. Finding group keys from invoices the user can access
  2. Returning ALL invoices in those groups (including ones from other departments)

  Fix: Only return invoices that the user actually has access to (uploaded_by, current_approver, or department member).
  The duplicate flag is shown only if at least 2 of the user's accessible invoices share the same group key.
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

  SET LOCAL row_security = off;

  IF v_is_admin THEN
    RETURN QUERY
    WITH all_invoices AS (
      SELECT
        i.id,
        i.invoice_number,
        i.supplier_name,
        i.supplier_nip,
        i.issue_date,
        i.due_date,
        i.net_amount,
        i.tax_amount,
        i.gross_amount,
        i.pln_gross_amount,
        i.exchange_rate,
        i.currency,
        i.status,
        i.description,
        i.uploaded_by,
        i.current_approver_id,
        i.department_id,
        i.cost_center_id,
        i.file_url,
        i.paid_at,
        i.paid_by,
        i.created_at,
        i.updated_at,
        i.source,
        i.is_duplicate,
        i.duplicate_invoice_ids,
        i.file_hash,
        i.user_drive_file_id,
        i.drive_owner_user_id,
        i.pz_number,
        i.bez_mpk,
        i.internal_comment,
        p.full_name AS uploader_name,
        p.role AS uploader_role,
        d.name AS dept_name
      FROM invoices i
      LEFT JOIN profiles p ON p.id = i.uploaded_by
      LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    grouped AS (
      SELECT
        CASE WHEN ai.supplier_nip IS NOT NULL AND ai.supplier_nip <> ''
        THEN regexp_replace(ai.supplier_nip, '[^0-9]', '', 'g') || '__' || ai.invoice_number
        ELSE 'name__' || lower(trim(COALESCE(ai.supplier_name, ''))) || '__' || ai.invoice_number
        END AS grp_key,
        ai.id AS inv_id
      FROM all_invoices ai
    ),
    dup_keys AS (
      SELECT g.grp_key FROM grouped g GROUP BY g.grp_key HAVING count(*) >= 2
    ),
    dup_ids AS (
      SELECT DISTINCT g.inv_id FROM grouped g INNER JOIN dup_keys dk ON g.grp_key = dk.grp_key
    )
    SELECT
      ai.id, ai.invoice_number, ai.supplier_name, ai.supplier_nip,
      ai.issue_date, ai.due_date, ai.net_amount, ai.tax_amount, ai.gross_amount,
      ai.pln_gross_amount, ai.exchange_rate, ai.currency, ai.status,
      ai.description, ai.uploaded_by,
      ai.uploader_name, ai.uploader_role,
      ai.current_approver_id, ai.department_id,
      ai.dept_name, ai.cost_center_id,
      ai.file_url, ai.paid_at, ai.paid_by, ai.created_at, ai.updated_at,
      ai.source, ai.is_duplicate,
      (ai.duplicate_invoice_ids)::uuid[],
      ai.file_hash, ai.user_drive_file_id, ai.drive_owner_user_id,
      ai.pz_number, ai.bez_mpk, ai.internal_comment
    FROM all_invoices ai
    WHERE ai.id IN (SELECT di.inv_id FROM dup_ids di)
    OR ai.is_duplicate = true;

  ELSE
    -- For non-admin users: only return invoices they can access,
    -- and only if at least 2 of their accessible invoices share the same group key.
    RETURN QUERY
    WITH user_invoices AS (
      -- Invoices the user has access to
      SELECT
        i.id AS inv_id,
        CASE WHEN i.supplier_nip IS NOT NULL AND i.supplier_nip <> ''
        THEN regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') || '__' || i.invoice_number
        ELSE 'name__' || lower(trim(COALESCE(i.supplier_name, ''))) || '__' || i.invoice_number
        END AS grp_key
      FROM invoices i
      LEFT JOIN department_members dm ON dm.department_id = i.department_id AND dm.user_id = v_caller_id
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
        AND (
          i.uploaded_by = v_caller_id
          OR i.current_approver_id = v_caller_id
          OR dm.user_id IS NOT NULL
        )
    ),
    dup_keys AS (
      -- Group keys where the user can see at least 2 invoices
      SELECT ui.grp_key
      FROM user_invoices ui
      GROUP BY ui.grp_key
      HAVING count(*) >= 2
    ),
    dup_ids AS (
      SELECT DISTINCT ui.inv_id
      FROM user_invoices ui
      INNER JOIN dup_keys dk ON ui.grp_key = dk.grp_key
    )
    SELECT
      av.id, av.invoice_number, av.supplier_name, av.supplier_nip,
      av.issue_date, av.due_date, av.net_amount, av.tax_amount, av.gross_amount,
      av.pln_gross_amount, av.exchange_rate, av.currency, av.status,
      av.description, av.uploaded_by,
      p.full_name AS uploader_name, p.role AS uploader_role,
      av.current_approver_id, av.department_id,
      d.name AS dept_name, av.cost_center_id,
      av.file_url, av.paid_at, av.paid_by, av.created_at, av.updated_at,
      av.source, av.is_duplicate,
      (av.duplicate_invoice_ids)::uuid[],
      av.file_hash, av.user_drive_file_id, av.drive_owner_user_id,
      av.pz_number, av.bez_mpk, av.internal_comment
    FROM invoices av
    LEFT JOIN profiles p ON p.id = av.uploaded_by
    LEFT JOIN departments d ON d.id = av.department_id
    WHERE av.id IN (SELECT di.inv_id FROM dup_ids di);
  END IF;
END;
$$;
