/*
  # Fix KSEF Invoice Source Field
  
  ## Problem
  - Invoices transferred from KSEF have source='manual' instead of source='ksef'
  - This makes it hard to identify which invoices came from KSEF system
  
  ## Solution
  - Update all existing invoices that are linked to ksef_invoices table
  - Set their source field to 'ksef'
  
  ## Changes
  - Update invoices.source to 'ksef' for all invoices with matching ksef_invoices.transferred_to_invoice_id
*/

-- Update all invoices that were transferred from KSEF
UPDATE invoices
SET source = 'ksef'
WHERE id IN (
  SELECT transferred_to_invoice_id 
  FROM ksef_invoices 
  WHERE transferred_to_invoice_id IS NOT NULL
)
AND (source IS NULL OR source = 'manual');
