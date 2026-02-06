/*
  # Add exchange rate and PLN conversion fields

  1. Changes
    - Add `exchange_rate` column to store the currency exchange rate to PLN
    - Add `pln_gross_amount` column to store the converted amount in PLN
    - Add `exchange_rate_date` column to store when the rate was fetched
    
  2. Notes
    - For PLN invoices, exchange_rate will be 1.0
    - For foreign invoices, exchange_rate will be fetched from NBP API
    - pln_gross_amount = gross_amount * exchange_rate
    - This enables accurate limit checking and totals in PLN
*/

-- Add exchange rate columns
ALTER TABLE invoices 
ADD COLUMN IF NOT EXISTS exchange_rate DECIMAL(10, 6) DEFAULT 1.0,
ADD COLUMN IF NOT EXISTS pln_gross_amount DECIMAL(12, 2),
ADD COLUMN IF NOT EXISTS exchange_rate_date DATE;

-- Update existing PLN invoices
UPDATE invoices 
SET 
  exchange_rate = 1.0,
  pln_gross_amount = gross_amount,
  exchange_rate_date = COALESCE(issue_date, CURRENT_DATE)
WHERE currency = 'PLN' OR currency IS NULL;

-- Create function to automatically calculate PLN amount when gross_amount or exchange_rate changes
CREATE OR REPLACE FUNCTION calculate_pln_gross_amount()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.gross_amount IS NOT NULL AND NEW.exchange_rate IS NOT NULL THEN
    NEW.pln_gross_amount := NEW.gross_amount * NEW.exchange_rate;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger to auto-calculate PLN amount
DROP TRIGGER IF EXISTS trigger_calculate_pln_gross_amount ON invoices;
CREATE TRIGGER trigger_calculate_pln_gross_amount
  BEFORE INSERT OR UPDATE OF gross_amount, exchange_rate ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION calculate_pln_gross_amount();
