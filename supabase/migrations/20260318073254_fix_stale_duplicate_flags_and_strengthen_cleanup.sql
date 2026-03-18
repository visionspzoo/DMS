/*
  # Fix stale duplicate flags and strengthen cleanup trigger

  ## Problem
  Invoices can remain marked as `is_duplicate = true` even after all their
  referenced duplicate invoices have been deleted. The existing
  `cleanup_duplicate_references_on_delete` trigger only removes the specific
  deleted row's ID from arrays — but if the trigger misfired or was bypassed
  (e.g. cascading deletes, direct DB operations), stale IDs accumulate and
  the flag is never cleared.

  ## Changes

  ### 1. One-time cleanup
  Clears all stale flags right now.

  ### 2. Stronger cleanup trigger
  Replaces `cleanup_duplicate_references_on_delete` with a version that:
  - After removing the deleted ID, re-validates every remaining ID in the array
    against actually existing invoices (eliminates any other stale IDs at the same time)
  - Sets `is_duplicate = false` when the resulting valid array is empty

  ### 3. Scheduled / on-demand sanity RPC
  Drops and recreates `check_and_clean_duplicates` returning integer (count of
  fixed rows) so admins can call it at any time.
*/

-- ============================================================
-- 1. ONE-TIME CLEANUP of all stale flags
-- ============================================================
DO $$
DECLARE
  invoice_rec RECORD;
  valid_ids   uuid[];
  dup_id      uuid;
BEGIN
  FOR invoice_rec IN
    SELECT id, duplicate_invoice_ids
    FROM invoices
    WHERE is_duplicate = true
      AND duplicate_invoice_ids IS NOT NULL
  LOOP
    valid_ids := ARRAY[]::uuid[];

    FOREACH dup_id IN ARRAY invoice_rec.duplicate_invoice_ids
    LOOP
      IF EXISTS (SELECT 1 FROM invoices WHERE id = dup_id) THEN
        valid_ids := valid_ids || dup_id;
      END IF;
    END LOOP;

    IF array_length(valid_ids, 1) IS NULL OR array_length(valid_ids, 1) = 0 THEN
      UPDATE invoices
      SET is_duplicate = false,
          duplicate_invoice_ids = NULL
      WHERE id = invoice_rec.id;
    ELSE
      UPDATE invoices
      SET duplicate_invoice_ids = valid_ids
      WHERE id = invoice_rec.id;
    END IF;
  END LOOP;
END $$;

-- ============================================================
-- 2. STRONGER CLEANUP TRIGGER FUNCTION
-- ============================================================
CREATE OR REPLACE FUNCTION cleanup_duplicate_references_on_delete()
RETURNS TRIGGER AS $$
DECLARE
  affected  RECORD;
  valid_ids uuid[];
  dup_id    uuid;
BEGIN
  FOR affected IN
    SELECT id, duplicate_invoice_ids
    FROM invoices
    WHERE is_duplicate = true
      AND duplicate_invoice_ids @> ARRAY[OLD.id]
  LOOP
    valid_ids := ARRAY[]::uuid[];
    FOREACH dup_id IN ARRAY affected.duplicate_invoice_ids
    LOOP
      IF dup_id <> OLD.id AND EXISTS (SELECT 1 FROM invoices WHERE id = dup_id) THEN
        valid_ids := valid_ids || dup_id;
      END IF;
    END LOOP;

    IF array_length(valid_ids, 1) IS NULL OR array_length(valid_ids, 1) = 0 THEN
      UPDATE invoices
      SET is_duplicate = false,
          duplicate_invoice_ids = NULL
      WHERE id = affected.id;
    ELSE
      UPDATE invoices
      SET duplicate_invoice_ids = valid_ids
      WHERE id = affected.id;
    END IF;
  END LOOP;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS cleanup_duplicate_refs_trigger ON invoices;
CREATE TRIGGER cleanup_duplicate_refs_trigger
  AFTER DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_duplicate_references_on_delete();

-- ============================================================
-- 3. ON-DEMAND SANITY RPC
-- ============================================================
DROP FUNCTION IF EXISTS check_and_clean_duplicates();

CREATE FUNCTION check_and_clean_duplicates()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  invoice_rec RECORD;
  valid_ids   uuid[];
  dup_id      uuid;
  fixed_count integer := 0;
BEGIN
  FOR invoice_rec IN
    SELECT id, duplicate_invoice_ids
    FROM invoices
    WHERE is_duplicate = true
      AND duplicate_invoice_ids IS NOT NULL
  LOOP
    valid_ids := ARRAY[]::uuid[];
    FOREACH dup_id IN ARRAY invoice_rec.duplicate_invoice_ids
    LOOP
      IF EXISTS (SELECT 1 FROM invoices WHERE id = dup_id) THEN
        valid_ids := valid_ids || dup_id;
      END IF;
    END LOOP;

    IF array_length(valid_ids, 1) IS NULL OR array_length(valid_ids, 1) = 0 THEN
      UPDATE invoices
      SET is_duplicate = false,
          duplicate_invoice_ids = NULL
      WHERE id = invoice_rec.id;
      fixed_count := fixed_count + 1;
    ELSIF array_length(valid_ids, 1) <> array_length(invoice_rec.duplicate_invoice_ids, 1) THEN
      UPDATE invoices
      SET duplicate_invoice_ids = valid_ids
      WHERE id = invoice_rec.id;
      fixed_count := fixed_count + 1;
    END IF;
  END LOOP;

  RETURN fixed_count;
END $$;

GRANT EXECUTE ON FUNCTION check_and_clean_duplicates() TO authenticated;
