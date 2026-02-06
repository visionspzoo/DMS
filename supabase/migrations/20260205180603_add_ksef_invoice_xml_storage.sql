/*
  # Add XML storage and PDF download support for KSeF invoices

  1. Changes
    - Add `xml_content` column to store invoice XML from KSeF
    - Add `xml_fetched_at` column to track when XML was downloaded
    
  2. Purpose
    - Enable PDF generation from XML content
    - Track XML download status for each invoice
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'xml_content'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN xml_content text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'xml_fetched_at'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN xml_fetched_at timestamptz;
  END IF;
END $$;