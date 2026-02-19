/*
  # Add ignored status to KSEF invoices

  ## Summary
  Adds the ability to mark KSEF invoices as "ignored" - invoices that should not be
  assigned to any department and are explicitly excluded from the workflow.

  ## Changes

  ### Modified Tables
  - `ksef_invoices`
    - `ignored_at` (timestamptz, nullable) - timestamp when the invoice was marked as ignored
    - `ignored_reason` (text, nullable) - required comment explaining why the invoice is ignored
    - `ignored_by` (uuid, nullable) - user who marked the invoice as ignored

  ## Notes
  - Ignored invoices will appear in a separate "Ignorowane" tab
  - Any user can mark an invoice as ignored (with a required reason)
  - Any user can restore an ignored invoice back to unassigned
  - Only unassigned invoices (not yet transferred) can be ignored
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'ignored_at'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN ignored_at timestamptz DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'ignored_reason'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN ignored_reason text DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'ignored_by'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN ignored_by uuid REFERENCES auth.users(id) DEFAULT NULL;
  END IF;
END $$;
