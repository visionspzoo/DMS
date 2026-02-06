/*
  # Add page_number to PDF annotations

  1. Changes
    - Add `page_number` column to `contract_pdf_annotations`
    - Default value of 1 for backward compatibility with existing annotations
    - Coordinates (x_percent, y_percent) are now relative to the specific page

  2. Notes
    - Existing annotations will default to page 1
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'contract_pdf_annotations' AND column_name = 'page_number'
  ) THEN
    ALTER TABLE contract_pdf_annotations ADD COLUMN page_number integer NOT NULL DEFAULT 1;
  END IF;
END $$;
