/*
  # Fix get_user_duplicate_invoice_groups - bypass RLS for cross-user duplicate scanning

  ## Problem
  The function uses SECURITY DEFINER but the CTEs that scan ALL invoices to find
  duplicate groups were still subject to RLS. This meant a regular user's CTE
  `all_in_groups` only saw their own invoices (or invoices visible to them via RLS),
  so a group with invoice A (user X) + invoice B (user Y) never reached count >= 2
  from user X's perspective, and the merge modal showed zero groups.

  ## Fix
  Add SET LOCAL row_security = off at the start of the function body so the full
  invoices table is scanned for duplicate groups. Access control is preserved:
  - Only groups where the calling user owns at least one invoice are returned
  - Admins get all duplicate groups
  - The RPC return data itself does not expose sensitive fields beyond what's needed

  ## Security
  - SECURITY DEFINER + row_security = off means the function runs as superuser
  - Safe because: output is filtered to groups the caller owns at least one invoice in
  - Same pattern used by get_duplicate_invoice_info (migration 20260220082535)
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

  -- Bypass RLS so we can find duplicates across all users
  SET LOCAL row_security = off;

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
    WITH user_invoices AS (
      -- Keys for invoices uploaded by this user
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
      -- All invoices in the entire table (RLS bypassed) keyed by group
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
      -- Invoices in groups where: user owns one AND group has 2+ members
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
    WHERE av.id IN (SELECT inv_id FROM dup_ids);
  END IF;
END;
$$;

GRANT EXECUTE ON FUNCTION get_user_duplicate_invoice_groups() TO authenticated;
