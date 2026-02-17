/*
  # Naprawa notyfikacji o duplikatach - AFTER INSERT

  1. Problem
    - Trigger BEFORE INSERT próbował tworzyć notyfikacje przed zapisaniem faktury
    - To powodowało błąd foreign key constraint na notifications.invoice_id

  2. Rozwiązanie
    - Rozdzielenie logiki na dwa triggery:
      - BEFORE: tylko oznacza duplikaty (modyfikuje NEW)
      - AFTER: wysyła notyfikacje (po zapisaniu faktury)
*/

-- ============================================================================
-- KROK 1: Funkcja BEFORE - tylko oznacza duplikaty
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_invoice_duplicates_before()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicate_ids uuid[];
BEGIN
  -- Sprawdź czy numer faktury nie jest pusty
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
    RETURN NEW;
  END IF;

  -- Sprawdź czy invoice_number się zmienił (dla UPDATE)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number THEN
      RETURN NEW;
    END IF;
  END IF;

  -- Znajdź wszystkie inne faktury o tym samym numerze
  SELECT ARRAY_AGG(id) INTO v_duplicate_ids
  FROM invoices
  WHERE invoice_number = NEW.invoice_number
    AND id != NEW.id
    AND invoice_number IS NOT NULL
    AND invoice_number != '';

  -- Oznacz jako duplikat jeśli znaleziono inne faktury
  IF v_duplicate_ids IS NOT NULL AND array_length(v_duplicate_ids, 1) > 0 THEN
    NEW.is_duplicate := true;
    NEW.duplicate_invoice_ids := v_duplicate_ids;
  ELSE
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KROK 2: Funkcja AFTER - wysyła notyfikacje
-- ============================================================================

CREATE OR REPLACE FUNCTION notify_invoice_duplicates_after()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicate_ids uuid[];
  v_duplicate_invoice RECORD;
  v_current_dept_name text;
  v_is_new_duplicate boolean;
BEGIN
  -- Sprawdź czy to faktycznie duplikat
  IF NOT NEW.is_duplicate OR NEW.duplicate_invoice_ids IS NULL THEN
    RETURN NEW;
  END IF;

  -- Dla UPDATE sprawdź czy to nowy duplikat
  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number AND OLD.is_duplicate = true THEN
      -- Już był oznaczony jako duplikat - nie wysyłaj notyfikacji ponownie
      RETURN NEW;
    END IF;
  END IF;

  v_duplicate_ids := NEW.duplicate_invoice_ids;
  v_is_new_duplicate := true;

  -- Oznacz wszystkie znalezione faktury jako duplikaty
  UPDATE invoices
  SET is_duplicate = true,
      duplicate_invoice_ids = (
        SELECT ARRAY_AGG(i.id)
        FROM invoices i
        WHERE i.invoice_number = NEW.invoice_number
          AND i.id != invoices.id
      )
  WHERE id = ANY(v_duplicate_ids)
    AND (is_duplicate = false OR duplicate_invoice_ids IS NULL OR NOT (NEW.id = ANY(COALESCE(duplicate_invoice_ids, ARRAY[]::uuid[]))));

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
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = v_duplicate_invoice.uploaded_by
        AND invoice_id = v_duplicate_invoice.id
        AND type = 'duplicate_detected'
        AND message LIKE '%' || NEW.invoice_number || '%'
    ) THEN
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
    END IF;

    -- Notyfikacja dla właściciela nowej faktury
    IF NOT EXISTS (
      SELECT 1 FROM notifications
      WHERE user_id = NEW.uploaded_by
        AND invoice_id = NEW.id
        AND type = 'duplicate_detected'
        AND message LIKE '%' || NEW.invoice_number || '%'
    ) THEN
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
    END IF;
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KROK 3: Usuń stary trigger i utwórz nowe
-- ============================================================================

DROP TRIGGER IF EXISTS detect_duplicates_on_invoice ON invoices;

-- Trigger BEFORE - oznacza duplikaty
CREATE TRIGGER detect_duplicates_before_invoice
  BEFORE INSERT OR UPDATE OF invoice_number ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION detect_invoice_duplicates_before();

-- Trigger AFTER - wysyła notyfikacje
CREATE TRIGGER notify_duplicates_after_invoice
  AFTER INSERT OR UPDATE OF invoice_number ON invoices
  FOR EACH ROW
  WHEN (NEW.is_duplicate = true)
  EXECUTE FUNCTION notify_invoice_duplicates_after();

COMMENT ON FUNCTION detect_invoice_duplicates_before() IS 
  'BEFORE trigger - oznacza faktury jako duplikaty';

COMMENT ON FUNCTION notify_invoice_duplicates_after() IS 
  'AFTER trigger - wysyła notyfikacje o duplikatach (po zapisaniu faktury)';
