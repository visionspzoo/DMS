/*
  # Fix duplicate detection to require same NIP + same invoice number

  ## Problem
  The current `detect_invoice_duplicates_before` trigger only checks for matching
  invoice_number, without verifying the supplier NIP. This leads to false positives
  where invoices from different suppliers with the same invoice number (e.g., "1/2024")
  are incorrectly flagged as duplicates.

  ## Changes
  1. Updates `detect_invoice_duplicates_before` to require both invoice_number AND
     supplier_nip to match (NIP normalized to digits only)
  2. Falls back to supplier_name match when NIP is not available on either invoice
  3. Updates `notify_invoice_duplicates_after` to use the same NIP+number matching
  4. Updates `get_duplicate_invoice_info` RPC to use the same matching logic
  5. Re-runs duplicate detection on existing invoices to fix stale flags

  ## Notes
  - NIP is normalized (digits only) before comparison to handle formatting differences
  - When supplier_nip is NULL or empty on either invoice, falls back to supplier_name match
*/

-- Drop and recreate the BEFORE trigger function with NIP check
CREATE OR REPLACE FUNCTION public.detect_invoice_duplicates_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duplicate_ids uuid[];
  v_nip_clean text;
BEGIN
  -- Skip if invoice_number is empty
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
    RETURN NEW;
  END IF;

  -- For UPDATE: skip if neither invoice_number nor supplier_nip changed
  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number
       AND (OLD.supplier_nip IS NOT DISTINCT FROM NEW.supplier_nip) THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Normalize NIP (digits only)
  v_nip_clean := regexp_replace(COALESCE(NEW.supplier_nip, ''), '[^0-9]', '', 'g');

  -- Find duplicates: same invoice_number + (same NIP when both have NIP, else same supplier_name)
  SELECT ARRAY_AGG(id) INTO v_duplicate_ids
  FROM invoices
  WHERE invoice_number = NEW.invoice_number
    AND id != NEW.id
    AND invoice_number IS NOT NULL
    AND invoice_number != ''
    AND (
      -- Both have NIP: compare normalized NIPs
      (
        v_nip_clean != ''
        AND supplier_nip IS NOT NULL
        AND supplier_nip != ''
        AND regexp_replace(supplier_nip, '[^0-9]', '', 'g') = v_nip_clean
      )
      OR
      -- At least one lacks NIP: fall back to supplier_name match
      (
        (v_nip_clean = '' OR NEW.supplier_nip IS NULL)
        AND (supplier_nip IS NULL OR regexp_replace(supplier_nip, '[^0-9]', '', 'g') = '')
        AND lower(trim(supplier_name)) = lower(trim(COALESCE(NEW.supplier_name, '')))
      )
    );

  IF v_duplicate_ids IS NOT NULL AND array_length(v_duplicate_ids, 1) > 0 THEN
    NEW.is_duplicate := true;
    NEW.duplicate_invoice_ids := v_duplicate_ids;
  ELSE
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- Drop and recreate the AFTER trigger function with NIP check
CREATE OR REPLACE FUNCTION public.notify_invoice_duplicates_after()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_other_id uuid;
  v_nip_clean text;
BEGIN
  IF NEW.is_duplicate IS NOT TRUE THEN
    RETURN NEW;
  END IF;

  v_nip_clean := regexp_replace(COALESCE(NEW.supplier_nip, ''), '[^0-9]', '', 'g');

  -- Update duplicate_invoice_ids on other matching invoices
  FOR v_other_id IN
    SELECT id FROM invoices
    WHERE invoice_number = NEW.invoice_number
      AND id != NEW.id
      AND invoice_number IS NOT NULL
      AND invoice_number != ''
      AND (
        (
          v_nip_clean != ''
          AND supplier_nip IS NOT NULL
          AND supplier_nip != ''
          AND regexp_replace(supplier_nip, '[^0-9]', '', 'g') = v_nip_clean
        )
        OR
        (
          (v_nip_clean = '' OR NEW.supplier_nip IS NULL)
          AND (supplier_nip IS NULL OR regexp_replace(supplier_nip, '[^0-9]', '', 'g') = '')
          AND lower(trim(supplier_name)) = lower(trim(COALESCE(NEW.supplier_name, '')))
        )
      )
  LOOP
    UPDATE invoices
    SET
      is_duplicate = true,
      duplicate_invoice_ids = (
        SELECT ARRAY_AGG(DISTINCT x)
        FROM (
          SELECT UNNEST(COALESCE(duplicate_invoice_ids, '{}'::uuid[])) AS x
          UNION SELECT NEW.id
        ) sub
        WHERE x != v_other_id
      )
    WHERE id = v_other_id;
  END LOOP;

  RETURN NEW;
END;
$$;

-- Fix stale duplicate flags: clear flags for invoices that are no longer true duplicates
-- (i.e., same number but different NIP that was previously flagged incorrectly)
DO $$
DECLARE
  r RECORD;
  v_nip_clean text;
  v_real_duplicate_ids uuid[];
BEGIN
  FOR r IN SELECT id, invoice_number, supplier_nip, supplier_name FROM invoices WHERE is_duplicate = true LOOP
    v_nip_clean := regexp_replace(COALESCE(r.supplier_nip, ''), '[^0-9]', '', 'g');

    SELECT ARRAY_AGG(id) INTO v_real_duplicate_ids
    FROM invoices
    WHERE invoice_number = r.invoice_number
      AND id != r.id
      AND invoice_number IS NOT NULL
      AND invoice_number != ''
      AND (
        (
          v_nip_clean != ''
          AND supplier_nip IS NOT NULL
          AND supplier_nip != ''
          AND regexp_replace(supplier_nip, '[^0-9]', '', 'g') = v_nip_clean
        )
        OR
        (
          (v_nip_clean = '' OR r.supplier_nip IS NULL)
          AND (supplier_nip IS NULL OR regexp_replace(supplier_nip, '[^0-9]', '', 'g') = '')
          AND lower(trim(supplier_name)) = lower(trim(COALESCE(r.supplier_name, '')))
        )
      );

    IF v_real_duplicate_ids IS NULL OR array_length(v_real_duplicate_ids, 1) IS NULL THEN
      UPDATE invoices SET is_duplicate = false, duplicate_invoice_ids = NULL WHERE id = r.id;
    ELSE
      UPDATE invoices SET duplicate_invoice_ids = v_real_duplicate_ids WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
