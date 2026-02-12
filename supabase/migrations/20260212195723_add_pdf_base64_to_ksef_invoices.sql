/*
  # Add pdf_base64 column to ksef_invoices

  1. Changes
    - Add `pdf_base64` (text, nullable) column to `ksef_invoices` table
    - Stores base64-encoded PDF content downloaded from KSEF API

  2. Reason
    - PDF is needed when transferring KSEF invoices to the main invoices system
    - Without this column, transfer fails with "Faktura KSEF nie ma zapisanego PDF"
    - PDF is downloaded during KSEF invoice fetch and stored for later use
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'pdf_base64'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN pdf_base64 text;
  END IF;
END $$;