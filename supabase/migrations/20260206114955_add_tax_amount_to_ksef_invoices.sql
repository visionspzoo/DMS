/*
  # Dodanie pola tax_amount do tabeli ksef_invoices

  1. Zmiany
    - Dodanie kolumny `tax_amount` (numeric) do tabeli `ksef_invoices`
    - Pole zawiera kwotę VAT (obliczaną jako gross_amount - net_amount)
    - Domyślnie NULL dla istniejących rekordów

  2. Aktualizacja istniejących danych
    - Obliczenie tax_amount dla wszystkich istniejących faktur
*/

-- Dodaj kolumnę tax_amount do tabeli ksef_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'tax_amount'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN tax_amount numeric(12, 2);
  END IF;
END $$;

-- Oblicz tax_amount dla wszystkich istniejących faktur
UPDATE ksef_invoices
SET tax_amount = gross_amount - net_amount
WHERE tax_amount IS NULL;