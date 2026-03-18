/*
  # Add RPC: get_user_duplicate_invoice_groups

  Returns all invoices that belong to duplicate groups where the current user
  owns at least one invoice in the group. This bypasses RLS so that a user
  can see other users' invoices that are duplicates of their own invoices,
  enabling them to use the "Merge Duplicates" feature.

  1. Logic
    - Finds all invoices owned by the current user that are marked as duplicates
      OR have duplicate_invoice_ids pointing to other invoices
    - Also includes invoices with the same (NIP + invoice_number) or
      (supplier_name + invoice_number) as the user's own invoices
    - Returns all invoice rows needed to display and merge duplicate groups

  2. Security
    - SECURITY DEFINER so it can bypass RLS to load linked invoices
    - Only returns invoices that are in groups where caller owns at least one
    - Admins get all duplicate groups across all users
*/

CREATE OR REPLACE FUNCTION get_user_duplicate_invoice_groups()
RETURNS TABLE (
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
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN;
  END IF;

  SELECT is_admin INTO v_is_admin FROM profiles WHERE id = v_caller_id;
  v_is_admin := COALESCE(v_is_admin, false);

  IF v_is_admin THEN
    -- Admins see all duplicate groups
    RETURN QUERY
    WITH all_invoices AS (
      SELECT i.*,
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
        CASE WHEN supplier_nip IS NOT NULL AND supplier_nip <> ''
          THEN regexp_replace(supplier_nip, '[^0-9]', '', 'g') || '__' || invoice_number
          ELSE 'name__' || lower(trim(COALESCE(supplier_name, ''))) || '__' || invoice_number
        END AS grp_key,
        id AS inv_id
      FROM all_invoices
    ),
    dup_keys AS (
      SELECT grp_key FROM grouped GROUP BY grp_key HAVING count(*) >= 2
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
    WHERE ai.id IN (SELECT inv_id FROM dup_ids)
       OR ai.is_duplicate = true;

  ELSE
    -- Regular users: find groups where they own at least one invoice
    RETURN QUERY
    WITH all_visible AS (
      -- All invoices visible to this user (their own, their department's, etc.)
      SELECT i.*,
        p.full_name AS uploader_name,
        p.role AS uploader_role,
        d.name AS dept_name
      FROM invoices i
      LEFT JOIN profiles p ON p.id = i.uploaded_by
      LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    user_invoices AS (
      SELECT i.id,
        CASE WHEN i.supplier_nip IS NOT NULL AND i.supplier_nip <> ''
          THEN regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') || '__' || i.invoice_number
          ELSE 'name__' || lower(trim(COALESCE(i.supplier_name, ''))) || '__' || i.invoice_number
        END AS grp_key
      FROM invoices i
      WHERE i.uploaded_by = v_caller_id
        AND i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    all_in_groups AS (
      SELECT
        CASE WHEN i.supplier_nip IS NOT NULL AND i.supplier_nip <> ''
          THEN regexp_replace(i.supplier_nip, '[^0-9]', '', 'g') || '__' || i.invoice_number
          ELSE 'name__' || lower(trim(COALESCE(i.supplier_name, ''))) || '__' || i.invoice_number
        END AS grp_key,
        i.id AS inv_id
      FROM invoices i
      WHERE i.invoice_number IS NOT NULL AND i.invoice_number <> ''
    ),
    user_grp_keys AS (
      SELECT DISTINCT grp_key FROM user_invoices
    ),
    dup_ids AS (
      SELECT DISTINCT aig.inv_id
      FROM all_in_groups aig
      INNER JOIN user_grp_keys ugk ON aig.grp_key = ugk.grp_key
      WHERE EXISTS (
        SELECT 1 FROM all_in_groups aig2
        WHERE aig2.grp_key = aig.grp_key
        GROUP BY aig2.grp_key
        HAVING count(*) >= 2
      )
    )
    SELECT
      av.id, av.invoice_number, av.supplier_name, av.supplier_nip,
      av.issue_date, av.due_date, av.net_amount, av.tax_amount, av.gross_amount,
      av.pln_gross_amount, av.exchange_rate, av.currency, av.status,
      av.description, av.uploaded_by,
      av.uploader_name, av.uploader_role,
      av.current_approver_id, av.department_id,
      av.dept_name, av.cost_center_id,
      av.file_url, av.paid_at, av.paid_by, av.created_at, av.updated_at,
      av.source, av.is_duplicate,
      (av.duplicate_invoice_ids)::uuid[],
      av.file_hash, av.user_drive_file_id, av.drive_owner_user_id,
      av.pz_number, av.bez_mpk, av.internal_comment
    FROM all_visible av
    WHERE av.id IN (SELECT inv_id FROM dup_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_duplicate_invoice_groups() TO authenticated;
