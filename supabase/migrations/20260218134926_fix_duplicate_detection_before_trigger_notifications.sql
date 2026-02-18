/*
  # Fix duplicate invoice detection - remove notifications from BEFORE trigger

  ## Problem
  The `detect_invoice_duplicates` function (called by `check_invoice_duplicates` BEFORE trigger)
  was inserting rows into `notifications` table with `invoice_id = NEW.id` before the invoice
  row was committed. This violates the foreign key constraint `notifications_invoice_id_fkey`.

  ## Fix
  - Drop the `check_invoice_duplicates` BEFORE trigger (it duplicates `detect_duplicates_before_invoice`)
  - Replace `detect_invoice_duplicates` function to only set flags, no notification inserts
  - Notifications are correctly handled by `notify_duplicates_after_invoice` AFTER trigger
*/

-- Drop the duplicate BEFORE trigger that was causing FK violations
DROP TRIGGER IF EXISTS check_invoice_duplicates ON invoices;

-- Replace detect_invoice_duplicates to only set flags (no notification inserts)
-- so it is safe to call from a BEFORE trigger context
CREATE OR REPLACE FUNCTION public.detect_invoice_duplicates()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
  v_duplicate_ids uuid[];
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number THEN
      RETURN NEW;
    END IF;
  END IF;

  SELECT ARRAY_AGG(id) INTO v_duplicate_ids
  FROM invoices
  WHERE invoice_number = NEW.invoice_number
    AND id != NEW.id
    AND invoice_number IS NOT NULL
    AND invoice_number != '';

  IF v_duplicate_ids IS NOT NULL AND array_length(v_duplicate_ids, 1) > 0 THEN
    NEW.is_duplicate := true;
    NEW.duplicate_invoice_ids := v_duplicate_ids;
  ELSE
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
  END IF;

  RETURN NEW;
END;
$function$;
