/*
  # System Detekcji Duplikatów Faktur

  1. Dodanie kolumny is_duplicate do faktur
  2. Trigger wykrywający duplikaty na podstawie invoice_number
  3. Automatyczne notyfikacje o duplikatach dla obu działów
  4. Widoczność informacji o duplikatach
*/

-- ============================================================================
-- KROK 1: Rozszerz typy notyfikacji o duplicate_detected
-- ============================================================================

ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
  CHECK (type IN (
    'new_invoice', 
    'status_change', 
    'pending_review', 
    'invoice_assigned',
    'new_contract', 
    'contract_status_change',
    'duplicate_detected'
  ));

-- ============================================================================
-- KROK 2: Dodaj kolumny do tabeli invoices
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'is_duplicate'
  ) THEN
    ALTER TABLE invoices ADD COLUMN is_duplicate boolean DEFAULT false;
  END IF;
  
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'duplicate_invoice_ids'
  ) THEN
    ALTER TABLE invoices ADD COLUMN duplicate_invoice_ids uuid[];
  END IF;
END $$;

COMMENT ON COLUMN invoices.is_duplicate IS 
  'Oznacza czy faktura jest duplikatem (istnieje inna faktura o tym samym numerze)';
  
COMMENT ON COLUMN invoices.duplicate_invoice_ids IS 
  'Lista ID innych faktur o tym samym numerze';

-- ============================================================================
-- KROK 3: Funkcja wykrywająca duplikaty
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_invoice_duplicates()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicate_ids uuid[];
  v_duplicate_invoice RECORD;
  v_current_dept_name text;
BEGIN
  -- Sprawdź czy numer faktury nie jest pusty
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    RETURN NEW;
  END IF;

  -- Znajdź wszystkie inne faktury o tym samym numerze
  SELECT ARRAY_AGG(id) INTO v_duplicate_ids
  FROM invoices
  WHERE invoice_number = NEW.invoice_number
    AND id != NEW.id
    AND invoice_number IS NOT NULL
    AND invoice_number != '';

  -- Jeśli znaleziono duplikaty
  IF v_duplicate_ids IS NOT NULL AND array_length(v_duplicate_ids, 1) > 0 THEN
    -- Oznacz obecną fakturę jako duplikat
    NEW.is_duplicate := true;
    NEW.duplicate_invoice_ids := v_duplicate_ids;

    -- Oznacz wszystkie znalezione faktury jako duplikaty
    UPDATE invoices
    SET is_duplicate = true,
        duplicate_invoice_ids = array_append(
          COALESCE(duplicate_invoice_ids, ARRAY[]::uuid[]),
          NEW.id
        )
    WHERE id = ANY(v_duplicate_ids);

    -- Pobierz nazwę działu obecnej faktury
    SELECT name INTO v_current_dept_name
    FROM departments
    WHERE id = NEW.department_id;

    -- Utwórz notyfikacje dla każdego duplikatu
    FOR v_duplicate_invoice IN
      SELECT i.id, i.uploaded_by, i.department_id, d.name as dept_name
      FROM invoices i
      LEFT JOIN departments d ON d.id = i.department_id
      WHERE i.id = ANY(v_duplicate_ids)
    LOOP
      -- Notyfikacja dla właściciela istniejącego duplikatu
      INSERT INTO notifications (
        user_id,
        invoice_id,
        type,
        title,
        message,
        is_read
      ) VALUES (
        v_duplicate_invoice.uploaded_by,
        v_duplicate_invoice.id,
        'duplicate_detected',
        'Wykryto duplikat faktury',
        format('UWAGA: Faktura nr %s w dziale "%s" jest duplikatem faktury z działu "%s"',
          NEW.invoice_number,
          COALESCE(v_duplicate_invoice.dept_name, 'nieprzypisany'),
          COALESCE(v_current_dept_name, 'nieprzypisany')
        ),
        false
      );

      -- Notyfikacja dla właściciela nowej faktury
      INSERT INTO notifications (
        user_id,
        invoice_id,
        type,
        title,
        message,
        is_read
      ) VALUES (
        NEW.uploaded_by,
        NEW.id,
        'duplicate_detected',
        'Wykryto duplikat faktury',
        format('UWAGA: Faktura nr %s w dziale "%s" jest duplikatem faktury z działu "%s"',
          NEW.invoice_number,
          COALESCE(v_current_dept_name, 'nieprzypisany'),
          COALESCE(v_duplicate_invoice.dept_name, 'nieprzypisany')
        ),
        false
      );
    END LOOP;

    -- Loguj wykrycie duplikatu
    INSERT INTO audit_logs (
      invoice_id,
      user_id,
      action,
      description
    ) VALUES (
      NEW.id,
      COALESCE(auth.uid(), NEW.uploaded_by),
      'duplicate_detected',
      format('Wykryto %s duplikat(ów) faktury nr %s',
        array_length(v_duplicate_ids, 1),
        NEW.invoice_number
      )
    );
  ELSE
    -- Brak duplikatów - wyczyść flagę
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KROK 4: Utwórz trigger dla nowych i edytowanych faktur
-- ============================================================================

DROP TRIGGER IF EXISTS check_invoice_duplicates ON invoices;

CREATE TRIGGER check_invoice_duplicates
  BEFORE INSERT OR UPDATE OF invoice_number ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION detect_invoice_duplicates();

-- ============================================================================
-- KROK 5: Funkcja pomocnicza do wysłania notyfikacji o istniejących duplikatach
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_invoice_duplicates_for_existing(p_invoice_number text)
RETURNS void AS $$
DECLARE
  v_invoice RECORD;
  v_other_invoice RECORD;
BEGIN
  -- Dla każdej faktury o podanym numerze
  FOR v_invoice IN
    SELECT i.id, i.uploaded_by, i.department_id, d.name as dept_name
    FROM invoices i
    LEFT JOIN departments d ON d.id = i.department_id
    WHERE i.invoice_number = p_invoice_number
  LOOP
    -- Sprawdź czy już nie ma notyfikacji o duplikacie dla tej faktury
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE invoice_id = v_invoice.id
        AND type = 'duplicate_detected'
        AND user_id = v_invoice.uploaded_by
    ) THEN
      -- Utwórz notyfikacje dla pozostałych duplikatów
      FOR v_other_invoice IN
        SELECT i.id, i.department_id, d.name as dept_name
        FROM invoices i
        LEFT JOIN departments d ON d.id = i.department_id
        WHERE i.invoice_number = p_invoice_number
          AND i.id != v_invoice.id
        LIMIT 1
      LOOP
        INSERT INTO notifications (
          user_id,
          invoice_id,
          type,
          title,
          message,
          is_read
        ) VALUES (
          v_invoice.uploaded_by,
          v_invoice.id,
          'duplicate_detected',
          'Wykryto duplikat faktury',
          format('UWAGA: Faktura nr %s w dziale "%s" jest duplikatem faktury z działu "%s"',
            p_invoice_number,
            COALESCE(v_invoice.dept_name, 'nieprzypisany'),
            COALESCE(v_other_invoice.dept_name, 'nieprzypisany')
          ),
          false
        );
      END LOOP;
    END IF;
  END LOOP;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KROK 6: Zaktualizuj istniejące faktury, aby wykryć duplikaty
-- ============================================================================

DO $$
DECLARE
  v_invoice_number text;
BEGIN
  -- Znajdź wszystkie numery faktur, które występują więcej niż raz
  FOR v_invoice_number IN
    SELECT invoice_number
    FROM invoices
    WHERE invoice_number IS NOT NULL
      AND invoice_number != ''
    GROUP BY invoice_number
    HAVING COUNT(*) > 1
  LOOP
    -- Oznacz wszystkie faktury o tym samym numerze jako duplikaty
    UPDATE invoices
    SET is_duplicate = true,
        duplicate_invoice_ids = (
          SELECT ARRAY_AGG(id)
          FROM invoices i2
          WHERE i2.invoice_number = v_invoice_number
            AND i2.id != invoices.id
        )
    WHERE invoice_number = v_invoice_number;
    
    -- Wyślij notyfikacje dla każdej pary duplikatów
    PERFORM detect_invoice_duplicates_for_existing(v_invoice_number);
  END LOOP;
END $$;

-- ============================================================================
-- KROK 7: Dodaj widok do łatwego dostępu do informacji o duplikatach
-- ============================================================================

CREATE OR REPLACE VIEW invoice_duplicates AS
SELECT
  i1.id as invoice_id,
  i1.invoice_number,
  i1.department_id,
  d1.name as department_name,
  i1.uploaded_by,
  p1.full_name as uploader_name,
  i1.is_duplicate,
  i1.duplicate_invoice_ids,
  (
    SELECT json_agg(
      json_build_object(
        'id', i2.id,
        'department_id', i2.department_id,
        'department_name', d2.name,
        'uploaded_by', i2.uploaded_by,
        'uploader_name', p2.full_name,
        'created_at', i2.created_at,
        'status', i2.status
      )
    )
    FROM invoices i2
    LEFT JOIN departments d2 ON d2.id = i2.department_id
    LEFT JOIN profiles p2 ON p2.id = i2.uploaded_by
    WHERE i2.id = ANY(i1.duplicate_invoice_ids)
  ) as duplicate_details
FROM invoices i1
LEFT JOIN departments d1 ON d1.id = i1.department_id
LEFT JOIN profiles p1 ON p1.id = i1.uploaded_by
WHERE i1.is_duplicate = true;

COMMENT ON VIEW invoice_duplicates IS
  'Widok pokazujący wszystkie faktury oznaczone jako duplikaty wraz ze szczegółami powiązanych duplikatów';
