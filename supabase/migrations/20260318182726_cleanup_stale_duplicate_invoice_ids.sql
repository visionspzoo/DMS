/*
  # Cleanup stale duplicate_invoice_ids references

  ## Problem
  Some invoices have duplicate_invoice_ids arrays that contain UUIDs pointing to
  invoices that no longer exist (were deleted or merged). This causes:
  - False "DUPLIKAT!" warnings in invoice details
  - is_duplicate flag set to true when there are no actual duplicates

  ## Fix
  1. Remove UUIDs from duplicate_invoice_ids that don't exist in the invoices table
  2. Set is_duplicate = false for invoices where all referenced duplicates are gone
     and no actual duplicates exist by NIP+number matching
*/

-- Remove non-existent invoice IDs from duplicate_invoice_ids arrays
UPDATE invoices
SET duplicate_invoice_ids = ARRAY(
  SELECT elem
  FROM unnest(duplicate_invoice_ids) AS elem
  WHERE elem IN (SELECT id FROM invoices)
)
WHERE duplicate_invoice_ids IS NOT NULL
  AND array_length(duplicate_invoice_ids, 1) > 0
  AND EXISTS (
    SELECT 1
    FROM unnest(duplicate_invoice_ids) AS elem2
    LEFT JOIN invoices ref ON ref.id = elem2
    WHERE ref.id IS NULL
  );

-- Clear empty arrays and reset is_duplicate where no actual duplicates remain
UPDATE invoices
SET
  duplicate_invoice_ids = NULL,
  is_duplicate = false
WHERE
  (duplicate_invoice_ids IS NULL OR array_length(duplicate_invoice_ids, 1) = 0)
  AND is_duplicate = true
  AND NOT EXISTS (
    SELECT 1 FROM invoices i2
    WHERE i2.id <> invoices.id
      AND i2.invoice_number = invoices.invoice_number
      AND i2.invoice_number IS NOT NULL
      AND i2.invoice_number <> ''
      AND (
        (invoices.supplier_nip IS NOT NULL AND invoices.supplier_nip <> ''
          AND regexp_replace(i2.supplier_nip, '[^0-9]', '', 'g') = regexp_replace(invoices.supplier_nip, '[^0-9]', '', 'g'))
        OR
        ((invoices.supplier_nip IS NULL OR invoices.supplier_nip = '')
          AND invoices.supplier_name IS NOT NULL
          AND lower(i2.supplier_name) = lower(invoices.supplier_name))
      )
  );
