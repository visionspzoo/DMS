/*
  # Fix cleanup_duplicate_refs_trigger: BEFORE -> AFTER DELETE

  ## Problem
  When deleting multiple invoices at once (bulk delete), the BEFORE DELETE trigger
  `cleanup_duplicate_references_on_delete` runs for each row and tries to UPDATE
  other invoices rows. If those other rows are also being deleted in the same command,
  PostgreSQL throws: "tuple to be updated was already modified by an operation
  triggered by the current command".

  ## Fix
  Change the trigger timing from BEFORE to AFTER DELETE. An AFTER trigger runs
  after the row is deleted, so there's no conflict with other concurrent deletes.
  The hint in the PostgreSQL error message explicitly recommends this approach.
*/

DROP TRIGGER IF EXISTS cleanup_duplicate_refs_trigger ON invoices;

CREATE TRIGGER cleanup_duplicate_refs_trigger
  AFTER DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_duplicate_references_on_delete();
