/*
  # Dodanie statusu opłacenia faktury i limitów działu

  1. Zmiany w invoices
    - Dodaje kolumnę `paid_at` (timestamp) - kiedy faktura została oznaczona jako opłacona
    - Dodaje kolumnę `paid_by` (uuid) - kto oznaczył fakturę jako opłaconą
  
  2. Zmiany w departments
    - Dodaje kolumnę `max_invoice_amount` (numeric) - maksymalna kwota pojedynczej faktury bez dodatkowej akceptacji
    - Dodaje kolumnę `max_monthly_amount` (numeric) - maksymalna suma miesięcznych faktur bez dodatkowej akceptacji
  
  3. Bezpieczeństwo
    - Zachowuje istniejące dane
    - Dodaje proper constraints
*/

-- Dodaj kolumny do tabeli invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'paid_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN paid_at TIMESTAMPTZ;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'paid_by'
  ) THEN
    ALTER TABLE invoices ADD COLUMN paid_by UUID REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Dodaj kolumny do tabeli departments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'max_invoice_amount'
  ) THEN
    ALTER TABLE departments ADD COLUMN max_invoice_amount NUMERIC(10, 2) DEFAULT NULL;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'max_monthly_amount'
  ) THEN
    ALTER TABLE departments ADD COLUMN max_monthly_amount NUMERIC(10, 2) DEFAULT NULL;
  END IF;
END $$;

-- Dodaj komentarze do kolumn
COMMENT ON COLUMN invoices.paid_at IS 'Timestamp kiedy faktura została oznaczona jako opłacona';
COMMENT ON COLUMN invoices.paid_by IS 'ID użytkownika który oznaczył fakturę jako opłaconą';
COMMENT ON COLUMN departments.max_invoice_amount IS 'Maksymalna kwota pojedynczej faktury bez dodatkowej akceptacji';
COMMENT ON COLUMN departments.max_monthly_amount IS 'Maksymalna suma miesięcznych faktur bez dodatkowej akceptacji';

-- Dodaj index dla wydajności
CREATE INDEX IF NOT EXISTS idx_invoices_paid_at ON invoices(paid_at);
