/*
  # Naprawa detekcji duplikatów - automatyczne czyszczenie po usunięciu

  ## Problem
  Gdy faktura oznaczona jako duplikat jest usuwana, inne faktury dalej mają:
  - `is_duplicate = true`
  - `duplicate_invoice_ids` zawierające ID usuniętej faktury
  
  To powoduje czerwony border mimo że duplikat już nie istnieje.

  ## Rozwiązanie
  1. Wyczyść wszystkie nieaktualne flagi duplikatów
  2. Stwórz trigger, który po usunięciu faktury automatycznie wyczyści flagi duplikatów w innych fakturach
*/

-- ============================================================================
-- KROK 1: Wyczyść nieaktualne flagi duplikatów
-- ============================================================================

-- Funkcja pomocnicza do sprawdzenia czy wszystkie duplikaty istnieją
CREATE OR REPLACE FUNCTION check_and_clean_duplicates()
RETURNS void AS $$
DECLARE
  invoice_rec RECORD;
  valid_duplicates uuid[];
  dup_id uuid;
BEGIN
  -- Przejdź przez wszystkie faktury z flagą is_duplicate
  FOR invoice_rec IN 
    SELECT id, duplicate_invoice_ids 
    FROM invoices 
    WHERE is_duplicate = true AND duplicate_invoice_ids IS NOT NULL
  LOOP
    valid_duplicates := ARRAY[]::uuid[];
    
    -- Sprawdź każdy ID duplikatu czy istnieje
    FOREACH dup_id IN ARRAY invoice_rec.duplicate_invoice_ids
    LOOP
      IF EXISTS (SELECT 1 FROM invoices WHERE id = dup_id) THEN
        valid_duplicates := array_append(valid_duplicates, dup_id);
      END IF;
    END LOOP;
    
    -- Jeśli nie ma już żadnych duplikatów, wyczyść flagę
    IF array_length(valid_duplicates, 1) IS NULL OR array_length(valid_duplicates, 1) = 0 THEN
      UPDATE invoices 
      SET 
        is_duplicate = false,
        duplicate_invoice_ids = NULL
      WHERE id = invoice_rec.id;
      
      RAISE NOTICE 'Wyczyszczono flagę duplikatu dla faktury %', invoice_rec.id;
    ELSE
      -- Zaktualizuj listę duplikatów tylko do tych istniejących
      UPDATE invoices 
      SET duplicate_invoice_ids = valid_duplicates
      WHERE id = invoice_rec.id;
      
      RAISE NOTICE 'Zaktualizowano listę duplikatów dla faktury %', invoice_rec.id;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql;

-- Uruchom czyszczenie
SELECT check_and_clean_duplicates();

-- ============================================================================
-- KROK 2: Trigger do automatycznego czyszczenia po usunięciu faktury
-- ============================================================================

CREATE OR REPLACE FUNCTION cleanup_duplicate_references_on_delete()
RETURNS TRIGGER AS $$
BEGIN
  -- Znajdź wszystkie faktury, które mają usuwaną fakturę w duplicate_invoice_ids
  UPDATE invoices
  SET 
    duplicate_invoice_ids = array_remove(duplicate_invoice_ids, OLD.id),
    is_duplicate = CASE
      -- Jeśli po usunięciu nie ma już innych duplikatów, wyczyść flagę
      WHEN array_length(array_remove(duplicate_invoice_ids, OLD.id), 1) IS NULL 
        OR array_length(array_remove(duplicate_invoice_ids, OLD.id), 1) = 0 
      THEN false
      ELSE is_duplicate
    END
  WHERE 
    is_duplicate = true 
    AND duplicate_invoice_ids @> ARRAY[OLD.id];
  
  RETURN OLD;
END;
$$ LANGUAGE plpgsql;

-- Utwórz trigger
DROP TRIGGER IF EXISTS cleanup_duplicate_refs_trigger ON invoices;
CREATE TRIGGER cleanup_duplicate_refs_trigger
  BEFORE DELETE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION cleanup_duplicate_references_on_delete();

-- ============================================================================
-- KROK 3: Dodaj funkcję do ręcznego czyszczenia duplikatów
-- ============================================================================

-- Funkcja RPC, którą może wywołać frontend, aby wyczyścić flagi duplikatów dla konkretnej faktury
CREATE OR REPLACE FUNCTION clear_duplicate_flag(invoice_id_param uuid)
RETURNS void AS $$
BEGIN
  UPDATE invoices
  SET 
    is_duplicate = false,
    duplicate_invoice_ids = NULL
  WHERE id = invoice_id_param;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Nadaj uprawnienia
GRANT EXECUTE ON FUNCTION clear_duplicate_flag(uuid) TO authenticated;
