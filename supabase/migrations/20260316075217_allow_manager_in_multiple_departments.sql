/*
  # Allow manager to be assigned to multiple departments

  ## Problem
  The manager_limits table had a UNIQUE constraint on manager_id, which is correct
  (one limit record per manager), but there was no actual database constraint preventing
  a manager from being assigned to multiple departments in the departments table.

  The UNIQUE (manager_id) constraint on manager_limits does NOT prevent multi-department
  assignment - it only ensures one limit record per manager, which is the desired behavior.

  However, to make intent clear and ensure no implicit blocking occurs, we verify
  the departments table has no unique constraint on manager_id (confirmed - it does not).

  ## Changes
  - No structural change needed: departments.manager_id already allows duplicate values
  - manager_limits.manager_id remains UNIQUE (one limit record per manager is correct)
  - This migration documents that the system intentionally supports one manager
    being the manager_id of multiple departments rows simultaneously
  
  ## Note
  The only place that previously caused confusion was UI logic - the database already
  supports assigning a manager to multiple departments.
*/

-- Verify and document: departments table allows same manager_id in multiple rows.
-- The following is a no-op confirming no unique constraint exists on departments.manager_id.
-- (If such constraint existed we would drop it here, but it does not.)

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'departments'::regclass
      AND contype = 'u'
      AND conname ILIKE '%manager%'
  ) THEN
    EXECUTE 'ALTER TABLE departments DROP CONSTRAINT IF EXISTS departments_manager_id_key';
  END IF;
END $$;
