/*
  # Update get_purchase_requests_for_approval RPC - drop and recreate

  ## Changes
  - Drops old function signature and recreates with `has_director` column
  - `has_director` tells managers whether their approval will escalate to a director
*/

DROP FUNCTION IF EXISTS get_purchase_requests_for_approval();

CREATE OR REPLACE FUNCTION get_purchase_requests_for_approval()
RETURNS TABLE(
  id uuid,
  user_id uuid,
  submitter_name text,
  submitter_email text,
  department_id uuid,
  department_name text,
  link text,
  gross_amount numeric,
  description text,
  quantity integer,
  delivery_location text,
  priority text,
  status text,
  current_approver_id uuid,
  approver_comment text,
  submitted_at timestamptz,
  created_at timestamptz,
  proforma_filename text,
  has_director boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  RETURN QUERY
  SELECT
    pr.id,
    pr.user_id,
    p.full_name AS submitter_name,
    p.email AS submitter_email,
    pr.department_id,
    d.name AS department_name,
    pr.link,
    pr.gross_amount,
    pr.description,
    pr.quantity,
    pr.delivery_location,
    pr.priority,
    pr.status,
    pr.current_approver_id,
    pr.approver_comment,
    pr.submitted_at,
    pr.created_at,
    pr.proforma_filename,
    (d.director_id IS NOT NULL AND d.director_id != auth.uid()) AS has_director
  FROM purchase_requests pr
  LEFT JOIN profiles p ON p.id = pr.user_id
  LEFT JOIN departments d ON d.id = pr.department_id
  WHERE pr.current_approver_id = auth.uid()
  ORDER BY pr.submitted_at ASC NULLS LAST;
END;
$$;

GRANT EXECUTE ON FUNCTION get_purchase_requests_for_approval() TO authenticated;
