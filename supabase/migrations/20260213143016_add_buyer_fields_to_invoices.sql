/*
  # Dodanie pól odbiorcy do faktur

  1. Zmiany w tabelach
    - Dodanie kolumn `buyer_name` i `buyer_nip` do tabeli `invoices`
    - Dodanie kolumn `buyer_name` i `buyer_nip` do tabeli `ksef_invoices`
  
  2. Opis zmian
    - `buyer_name` (text, nullable) - nazwa odbiorcy faktury
    - `buyer_nip` (text, nullable) - NIP odbiorcy faktury
    - Pola są opcjonalne aby nie blokować istniejących faktur
  
  3. Walidacja
    - Prawidłowy odbiorca: "Aura Herbals" i NIP "5851490834" lub "PL5851490834"
    - Faktury z innym odbiorcą będą oznaczane jako błędne w interfejsie
*/

-- Dodanie pól odbiorcy do tabeli invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'buyer_name'
  ) THEN
    ALTER TABLE invoices ADD COLUMN buyer_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'buyer_nip'
  ) THEN
    ALTER TABLE invoices ADD COLUMN buyer_nip text;
  END IF;
END $$;

-- Dodanie pól odbiorcy do tabeli ksef_invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'buyer_name'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN buyer_name text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'ksef_invoices' AND column_name = 'buyer_nip'
  ) THEN
    ALTER TABLE ksef_invoices ADD COLUMN buyer_nip text;
  END IF;
END $$;