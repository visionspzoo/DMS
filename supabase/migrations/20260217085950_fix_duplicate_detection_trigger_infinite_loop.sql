/*
  # Naprawa triggera wykrywania duplikatów

  1. Zapobiega nieskończonej pętli przy aktualizacji faktur
  2. Wysyła notyfikacje tylko raz (nie przy każdym UPDATE)
  3. Sprawdza czy notyfikacja już istnieje przed wysłaniem
*/

-- ============================================================================
-- Ulepszona funkcja wykrywająca duplikaty
-- ============================================================================

CREATE OR REPLACE FUNCTION detect_invoice_duplicates()
RETURNS TRIGGER AS $$
DECLARE
  v_duplicate_ids uuid[];
  v_duplicate_invoice RECORD;
  v_current_dept_name text;
  v_is_new_duplicate boolean;
BEGIN
  -- Sprawdź czy numer faktury nie jest pusty
  IF NEW.invoice_number IS NULL OR NEW.invoice_number = '' THEN
    -- Wyczyść flagi duplikatu jeśli nie ma numeru
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
    RETURN NEW;
  END IF;

  -- Sprawdź czy invoice_number się zmienił (dla UPDATE)
  IF TG_OP = 'UPDATE' THEN
    IF OLD.invoice_number = NEW.invoice_number THEN
      -- Numer się nie zmienił - nie rób nic, zachowaj istniejące flagi
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

  -- Jeśli znaleziono duplikaty
  IF v_duplicate_ids IS NOT NULL AND array_length(v_duplicate_ids, 1) > 0 THEN
    -- Sprawdź czy to nowy duplikat (nie był oznaczony wcześniej)
    v_is_new_duplicate := (TG_OP = 'INSERT' OR OLD.is_duplicate = false);

    -- Oznacz obecną fakturę jako duplikat
    NEW.is_duplicate := true;
    NEW.duplicate_invoice_ids := v_duplicate_ids;

    -- Oznacz wszystkie znalezione faktury jako duplikaty (bez rekursywnego wywołania triggera)
    UPDATE invoices
    SET is_duplicate = true,
        duplicate_invoice_ids = (
          SELECT ARRAY_AGG(i.id)
          FROM invoices i
          WHERE i.invoice_number = NEW.invoice_number
            AND i.id != invoices.id
        )
    WHERE id = ANY(v_duplicate_ids)
      AND (is_duplicate = false OR duplicate_invoice_ids IS NULL OR NOT (NEW.id = ANY(duplicate_invoice_ids)));

    -- Wysyłaj notyfikacje tylko dla nowych duplikatów
    IF v_is_new_duplicate THEN
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
        -- Sprawdź czy notyfikacja już nie istnieje dla właściciela istniejącego duplikatu
        IF NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE user_id = v_duplicate_invoice.uploaded_by
            AND invoice_id = v_duplicate_invoice.id
            AND type = 'duplicate_detected'
            AND message LIKE '%' || NEW.invoice_number || '%'
        ) THEN
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
        END IF;

        -- Sprawdź czy notyfikacja już nie istnieje dla właściciela nowej faktury
        IF NOT EXISTS (
          SELECT 1 FROM notifications
          WHERE user_id = NEW.uploaded_by
            AND invoice_id = NEW.id
            AND type = 'duplicate_detected'
            AND message LIKE '%' || NEW.invoice_number || '%'
        ) THEN
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
        END IF;
      END LOOP;

      -- Loguj wykrycie duplikatu (tylko dla nowych duplikatów)
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
    END IF;
  ELSE
    -- Brak duplikatów - wyczyść flagę
    NEW.is_duplicate := false;
    NEW.duplicate_invoice_ids := NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION detect_invoice_duplicates() IS 
  'Wykrywa duplikaty faktur po numerze i wysyła notyfikacje. Zapobiega nieskończonej pętli przy UPDATE.';
