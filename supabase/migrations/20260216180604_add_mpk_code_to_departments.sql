/*
  # Dodaj numer MPK do działów

  1. Zmiany
    - Dodaj kolumnę `mpk_code` do tabeli `departments`
    - Kolumna będzie przechowywać numer MPK działu (opcjonalny)

  2. Szczegóły
    - `mpk_code` (text, nullable) - Numer MPK przypisany do działu
*/

-- Dodaj kolumnę mpk_code do tabeli departments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'mpk_code'
  ) THEN
    ALTER TABLE departments ADD COLUMN mpk_code text;
  END IF;
END $$;

-- Dodaj indeks dla szybszego wyszukiwania po kodzie MPK
CREATE INDEX IF NOT EXISTS idx_departments_mpk_code ON departments(mpk_code);
