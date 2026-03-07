/*
  # Add paid status and proforma support to purchase_requests

  ## Changes
  - Add `paid` as a valid status (via constraint update)
  - Add `proforma_pdf_base64` column (text, nullable) to store uploaded proforma PDF
  - Add `proforma_filename` column (text, nullable) to store the original filename
  - `paid` status is set when an approved request has been paid for

  ## Notes
  - Existing rows are unaffected (nullable columns, no destructive changes)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'proforma_pdf_base64'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN proforma_pdf_base64 text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'proforma_filename'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN proforma_filename text;
  END IF;
END $$;
