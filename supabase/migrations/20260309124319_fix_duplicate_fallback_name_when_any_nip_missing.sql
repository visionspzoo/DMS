/*
  # Fix duplicate detection fallback when either invoice lacks NIP

  ## Problem
  The previous trigger required BOTH invoices to lack a NIP before falling back
  to supplier_name comparison. This means a foreign invoice (no NIP) was never
  matched against a domestic invoice that does have a NIP, even if they're the
  same supplier.

  ## Fix
  When at least one invoice lacks a NIP, fall back to supplier_name comparison.
  This covers:
  - Foreign invoices (both lack NIP)
  - Mixed cases (one has NIP, one doesn't - e.g., same supplier uploaded twice
    with and without NIP)
*/

CREATE OR REPLACE FUNCTION public.detect_invoice_duplicates_before()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_duplicate_ids uuid[];
  v_nip_clean text;
BEGIN
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
    RETURN NEW;
  END IF;

  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number
       AND (OLD.supplier_nip IS NOT DISTINCT FROM NEW.supplier_nip)
       AND (OLD.supplier_name IS NOT DISTINCT FROM NEW.supplier_name) THEN
      RETURN NEW;
    END IF;
  END IF;

  v_nip_clean := regexp_replace(COALESCE(NEW.supplier_nip, ''), '[^0-9]', '', 'g');

  SELECT ARRAY_AGG(id) INTO v_duplicate_ids
  FROM invoices
  WHERE invoice_number = NEW.invoice_number
    AND id != NEW.id
    AND invoice_number IS NOT NULL
    AND invoice_number != ''
    AND (
      -- Both have NIP: match by NIP
      (
        v_nip_clean != ''
        AND supplier_nip IS NOT NULL
        AND supplier_nip != ''
        AND regexp_replace(supplier_nip, '[^0-9]', '', 'g') = v_nip_clean
      )
      OR
      -- At least one lacks NIP: fall back to supplier_name
      (
        (v_nip_clean = '' OR NEW.supplier_nip IS NULL OR NEW.supplier_nip = ''
         OR supplier_nip IS NULL OR supplier_nip = '')
        AND lower(trim(COALESCE(supplier_name, ''))) = lower(trim(COALESCE(NEW.supplier_name, '')))
        AND lower(trim(COALESCE(NEW.supplier_name, ''))) != ''
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
          (v_nip_clean = '' OR NEW.supplier_nip IS NULL OR NEW.supplier_nip = ''
           OR supplier_nip IS NULL OR supplier_nip = '')
          AND lower(trim(COALESCE(supplier_name, ''))) = lower(trim(COALESCE(NEW.supplier_name, '')))
          AND lower(trim(COALESCE(NEW.supplier_name, ''))) != ''
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
