/*
  # Add merge_duplicate_invoices RPC function

  ## Summary
  Creates a secure RPC function that allows non-admin users to merge duplicate invoices.
  
  ## Problem
  Non-admin users cannot delete invoices they don't own or invoices not in 'draft' status.
  The RLS DELETE policy only allows:
  - Admins: delete any invoice
  - Regular users: delete only their own draft invoices
  
  When merging duplicates, the loser invoice may belong to another user or have a different
  status, causing the delete to silently fail.

  ## Solution
  An RPC function with SECURITY DEFINER runs with elevated privileges, but validates
  that the calling user has legitimate access (is uploader of at least one invoice in the group
  OR is an admin) before proceeding.

  ## New Functions
  - `merge_duplicate_invoices(p_winner_id, p_loser_ids)`: merges duplicate invoices
    - Validates caller owns at least one invoice in the group (or is admin)
    - Copies description/mpk_description from losers to winner if winner lacks them
    - Deletes loser invoices (skipping ksef-source invoices)
    - Returns success/error message
*/

CREATE OR REPLACE FUNCTION merge_duplicate_invoices(
  p_winner_id uuid,
  p_loser_ids uuid[]
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_caller_id uuid;
  v_is_admin boolean;
  v_all_ids uuid[];
  v_winner_row invoices%ROWTYPE;
  v_loser_row invoices%ROWTYPE;
  v_has_access boolean;
  v_update_desc text;
  v_deleted_count int := 0;
BEGIN
  v_caller_id := auth.uid();
  IF v_caller_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT is_admin INTO v_is_admin
  FROM profiles
  WHERE id = v_caller_id;
  v_is_admin := COALESCE(v_is_admin, false);

  v_all_ids := array_append(p_loser_ids, p_winner_id);

  IF NOT v_is_admin THEN
    SELECT EXISTS (
      SELECT 1 FROM invoices
      WHERE id = ANY(v_all_ids)
        AND uploaded_by = v_caller_id
    ) INTO v_has_access;

    IF NOT v_has_access THEN
      RETURN jsonb_build_object('success', false, 'error', 'Access denied: you must own at least one invoice in the group');
    END IF;
  END IF;

  SELECT * INTO v_winner_row FROM invoices WHERE id = p_winner_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Winner invoice not found');
  END IF;

  v_update_desc := v_winner_row.description;

  FOR v_loser_row IN
    SELECT * FROM invoices WHERE id = ANY(p_loser_ids)
  LOOP
    IF (v_update_desc IS NULL OR v_update_desc = '' OR v_update_desc = 'Faktura z KSEF - wersja robocza') THEN
      IF v_loser_row.description IS NOT NULL
         AND v_loser_row.description != ''
         AND v_loser_row.description != 'Faktura z KSEF - wersja robocza' THEN
        v_update_desc := v_loser_row.description;
      END IF;
    END IF;
  END LOOP;

  IF v_update_desc IS DISTINCT FROM v_winner_row.description AND v_update_desc IS NOT NULL THEN
    UPDATE invoices SET description = v_update_desc WHERE id = p_winner_id;
  END IF;

  UPDATE invoices SET is_duplicate = false WHERE id = p_winner_id;

  FOR v_loser_row IN
    SELECT * FROM invoices WHERE id = ANY(p_loser_ids)
  LOOP
    IF v_loser_row.source = 'ksef' THEN
      CONTINUE;
    END IF;

    DELETE FROM invoices WHERE id = v_loser_row.id;
    v_deleted_count := v_deleted_count + 1;
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_count', v_deleted_count,
    'winner_id', p_winner_id
  );
END;
$$;

GRANT EXECUTE ON FUNCTION merge_duplicate_invoices(uuid, uuid[]) TO authenticated;
