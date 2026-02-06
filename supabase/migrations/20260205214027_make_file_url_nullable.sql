/*
  # Make file_url nullable for KSEF invoices

  ## Changes
  - Modify `invoices` table to allow NULL values in `file_url` column
  - This enables KSEF invoices (fetched from API) to be created without physical files
  
  ## Reasoning
  - KSEF invoices are fetched electronically and don't have associated PDF files initially
  - Users can still upload PDFs manually if needed
  - This change maintains data integrity while enabling KSEF integration
*/

ALTER TABLE invoices 
  ALTER COLUMN file_url DROP NOT NULL;
