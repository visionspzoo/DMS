/*
  # Uzupełnienie pln_gross_amount dla faktur w walutach obcych

  1. Problem
    - Faktury w EUR/USD dodane przed migracją exchange_rate mogą nie mieć pln_gross_amount
    - Powoduje to nieprawidłowe sumowanie w dashboardach

  2. Rozwiązanie
    - Dla faktur z exchange_rate i gross_amount: oblicz pln_gross_amount
    - Dla faktur bez exchange_rate ale z issue_date: ustaw domyślny exchange_rate 1.0
    - Trigger automatycznie przeliczy pln_gross_amount

  3. Zmiany
    - Aktualizuje wszystkie faktury bez pln_gross_amount
    - Ustawia exchange_rate na 1.0 dla faktur bez niego (OCR później zaktualizuje)
*/

-- Najpierw ustaw domyślny exchange_rate dla faktur które go nie mają
UPDATE invoices
SET 
  exchange_rate = 1.0,
  exchange_rate_date = COALESCE(issue_date, CURRENT_DATE)
WHERE exchange_rate IS NULL;

-- Przelicz pln_gross_amount dla wszystkich faktur które go nie mają
-- Trigger calculate_pln_gross_amount automatycznie to wykona
UPDATE invoices
SET updated_at = NOW()
WHERE pln_gross_amount IS NULL 
  AND gross_amount IS NOT NULL 
  AND exchange_rate IS NOT NULL;

-- Dla faktur PLN upewnij się że pln_gross_amount = gross_amount
UPDATE invoices
SET 
  exchange_rate = 1.0,
  pln_gross_amount = gross_amount
WHERE (currency = 'PLN' OR currency IS NULL)
  AND (exchange_rate IS NULL OR exchange_rate != 1.0 OR pln_gross_amount IS NULL);
