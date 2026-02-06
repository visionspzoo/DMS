/*
  # Add PDF Base64 Storage Column

  1. Changes
    - Add `pdf_base64` text column to `invoices` table
    - Store base64-encoded PDF data for inline display
    - This allows PDF preview without CORS issues

  2. Notes
    - Large PDFs may exceed text column limits (consider limiting file size to 5-10MB)
    - Base64 encoding increases size by ~33%
*/

-- Add pdf_base64 column
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS pdf_base64 TEXT;

-- Add comment
COMMENT ON COLUMN invoices.pdf_base64 IS 'Base64-encoded PDF data for inline display';
