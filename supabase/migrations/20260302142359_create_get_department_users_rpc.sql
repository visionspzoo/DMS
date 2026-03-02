/*
  # Create get_department_users RPC

  ## Purpose
  Returns all users that belong to a given department — including:
  - Users whose primary department_id matches
  - Users who are manager_id or director_id of the department
  - Users listed in department_members for that department

  This is needed because the department_members RLS policy only allows users
  to see their OWN memberships (user_id = auth.uid()), which prevents managers
  and specialists from seeing other users in target departments when transferring
  invoices.

  This SECURITY DEFINER function bypasses that restriction safely, since we only
  return non-sensitive profile info (id, full_name, email, role).
*/

CREATE OR REPLACE FUNCTION get_department_users(p_department_id uuid)
RETURNS TABLE (
  id uuid,
  full_name text,
  email text,
  role text,
  is_manager boolean,
  is_director boolean
)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, auth, extensions
AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT manager_id, director_id
  INTO v_manager_id, v_director_id
  FROM departments
  WHERE departments.id = p_department_id;

  RETURN QUERY
  SELECT DISTINCT ON (p.id)
    p.id,
    p.full_name,
    p.email,
    p.role,
    (p.id = v_manager_id) AS is_manager,
    (p.id = v_director_id) AS is_director
  FROM profiles p
  WHERE
    p.department_id = p_department_id
    OR p.id = v_manager_id
    OR p.id = v_director_id
    OR EXISTS (
      SELECT 1 FROM department_members dm
      WHERE dm.department_id = p_department_id
        AND dm.user_id = p.id
    )
  ORDER BY p.id, p.full_name;
END;
$$;

GRANT EXECUTE ON FUNCTION get_department_users(uuid) TO authenticated;
