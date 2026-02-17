/*
  # Uproszczenie flow akceptacji - usunięcie działów nadrzędnych

  1. Zmiany w widoczności roboczych faktur
    - Robocze specjalisty: widoczne dla właściciela, kierownika i dyrektora działu
    - Robocze kierownika: widoczne dla właściciela i dyrektora działu
    - Robocze dyrektora: widoczne tylko dla właściciela
    - Admin widzi wszystkie

  2. Uproszczenie flow akceptacji
    - Specjalista: w limitach działu → kierownik, powyżej → dyrektor
    - Kierownik: zawsze → dyrektor
    - Dyrektor: w limitach osobistych → automatyczna akceptacja, powyżej → CEO
    - CEO: automatyczna akceptacja
    - BRAK działów nadrzędnych

  3. Przekazanie faktury zmienia uploaded_by (już zaimplementowane)
  4. Akceptacja NIE zmienia uploaded_by
*/

-- ============================================================================
-- KROK 1: Popraw widoczność roboczych faktur
-- ============================================================================

-- Usuń istniejące polityki SELECT dla faktur
DROP POLICY IF EXISTS "Users can view invoices based on role and status" ON invoices;
DROP POLICY IF EXISTS "Admin can view all invoices including drafts" ON invoices;
DROP POLICY IF EXISTS "Users can view draft invoices based on uploader role" ON invoices;

-- Nowa polityka SELECT uwzględniająca role właściciela
CREATE POLICY "Users can view invoices based on role and ownership"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    -- Admin widzi wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- Nie-robocze faktury: widoczne według aktualnego workflow
    (
      status != 'draft' AND (
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
        OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'ceo'
        OR (
          department_id IN (
            SELECT department_id FROM department_members WHERE user_id = auth.uid()
          )
          AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('dyrektor', 'kierownik')
        )
      )
    )
    OR
    -- Robocze faktury: widoczność zależy od roli WŁAŚCICIELA (uploaded_by)
    (
      status = 'draft' AND (
        -- Właściciel zawsze widzi swoją fakturę
        uploaded_by = auth.uid()
        OR
        -- Robocze specjalisty: widzi kierownik i dyrektor tego działu
        (
          (SELECT role FROM profiles WHERE id = uploaded_by) = 'specjalista'
          AND department_id IN (
            SELECT department_id FROM department_members WHERE user_id = auth.uid()
          )
          AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('kierownik', 'dyrektor')
        )
        OR
        -- Robocze kierownika: widzi dyrektor tego działu
        (
          (SELECT role FROM profiles WHERE id = uploaded_by) = 'kierownik'
          AND department_id IN (
            SELECT department_id FROM department_members WHERE user_id = auth.uid()
          )
          AND (SELECT role FROM profiles WHERE id = auth.uid()) = 'dyrektor'
        )
        -- Robocze dyrektora: widzi tylko właściciel (covered by uploaded_by = auth.uid())
      )
    )
  );

-- ============================================================================
-- KROK 2: Usuń trigger log_invoice_update - NIE zmienia uploaded_by
-- ============================================================================

CREATE OR REPLACE FUNCTION log_invoice_update()
RETURNS TRIGGER AS $$
DECLARE
  old_status_text text;
  new_status_text text;
  actor_name text;
  old_approver_name text;
  new_approver_name text;
BEGIN
  -- Pobierz nazwę aktora
  SELECT full_name INTO actor_name
  FROM profiles
  WHERE id = auth.uid();

  -- Mapowanie statusów na czytelny tekst
  old_status_text := CASE OLD.status
    WHEN 'draft' THEN 'robocza'
    WHEN 'waiting' THEN 'oczekująca'
    WHEN 'accepted' THEN 'zaakceptowana'
    WHEN 'paid' THEN 'opłacona'
    WHEN 'rejected' THEN 'odrzucona'
    ELSE OLD.status
  END;

  new_status_text := CASE NEW.status
    WHEN 'draft' THEN 'robocza'
    WHEN 'waiting' THEN 'oczekująca'
    WHEN 'accepted' THEN 'zaakceptowana'
    WHEN 'paid' THEN 'opłacona'
    WHEN 'rejected' THEN 'odrzucona'
    ELSE NEW.status
  END;

  -- Pobierz nazwy akceptujących
  IF OLD.current_approver_id IS NOT NULL THEN
    SELECT full_name INTO old_approver_name FROM profiles WHERE id = OLD.current_approver_id;
  END IF;

  IF NEW.current_approver_id IS NOT NULL THEN
    SELECT full_name INTO new_approver_name FROM profiles WHERE id = NEW.current_approver_id;
  END IF;

  -- Loguj zmianę statusu
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'status_change',
      format('Zmiana statusu z "%s" na "%s" przez %s', old_status_text, new_status_text, COALESCE(actor_name, 'system'))
    );
  END IF;

  -- Loguj zmianę current_approver_id
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'approver_change',
      format('Zmiana akceptującego z "%s" na "%s"',
        COALESCE(old_approver_name, 'brak'),
        COALESCE(new_approver_name, 'brak')
      )
    );
  END IF;

  -- Loguj zmianę działu
  IF OLD.department_id IS DISTINCT FROM NEW.department_id THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, details)
    VALUES (
      NEW.id,
      auth.uid(),
      'department_change',
      format('Zmiana działu')
    );
  END IF;

  -- NIE zmieniaj uploaded_by przy akceptacji
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- ============================================================================
-- KROK 3: Uproszczone auto-przypisywanie (draft → waiting)
-- ============================================================================

CREATE OR REPLACE FUNCTION auto_assign_invoice_on_update()
RETURNS TRIGGER AS $$
DECLARE
  v_uploader_role text;
  v_uploader_department uuid;
  v_department_limit numeric;
  v_department_manager uuid;
  v_department_director uuid;
  v_current_month_total numeric;
BEGIN
  -- Tylko dla faktur ze statusem 'waiting' które były 'draft'
  IF NEW.status = 'waiting' AND OLD.status = 'draft' THEN

    -- Pobierz informacje o właścicielu (uploaded_by)
    SELECT role, department_id INTO v_uploader_role, v_uploader_department
    FROM profiles
    WHERE id = NEW.uploaded_by;

    -- Pobierz limit działu i hierarchię
    SELECT monthly_limit, manager_id, director_id 
    INTO v_department_limit, v_department_manager, v_department_director
    FROM departments
    WHERE id = v_uploader_department;

    -- UPROSZCZONY FLOW AKCEPTACJI (BEZ DZIAŁÓW NADRZĘDNYCH):

    -- 1. Specjalista
    IF v_uploader_role = 'specjalista' THEN
      -- Sprawdź limit działu
      SELECT COALESCE(SUM(pln_gross_amount), 0) INTO v_current_month_total
      FROM invoices
      WHERE department_id = v_uploader_department
        AND status IN ('accepted', 'paid')
        AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
        AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);

      IF (v_current_month_total + NEW.pln_gross_amount) <= COALESCE(v_department_limit, 999999999) THEN
        -- W limicie działu -> kierownik
        NEW.current_approver_id := v_department_manager;
      ELSE
        -- Powyżej limitu działu -> dyrektor
        NEW.current_approver_id := v_department_director;
      END IF;

    -- 2. Kierownik -> zawsze dyrektor
    ELSIF v_uploader_role = 'kierownik' THEN
      NEW.current_approver_id := v_department_director;

    -- 3. Dyrektor -> CEO
    ELSIF v_uploader_role = 'dyrektor' THEN
      NEW.current_approver_id := (SELECT id FROM profiles WHERE role = 'ceo' LIMIT 1);

    -- 4. CEO sam akceptuje
    ELSIF v_uploader_role = 'ceo' THEN
      NEW.current_approver_id := NEW.uploaded_by;
    END IF;

    -- Ustaw assigned_at
    NEW.assigned_at := NOW();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ============================================================================
-- KROK 4: Usuń stary handle_invoice_approval i utwórz nowy uproszczony
-- ============================================================================

DROP FUNCTION IF EXISTS handle_invoice_approval() CASCADE;

-- Nowa funkcja obsługująca akceptację (waiting → accepted)
CREATE FUNCTION handle_simple_invoice_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_approver_role text;
  v_director_limit numeric;
  v_current_month_total numeric;
  v_ceo_id uuid;
BEGIN
  -- Tylko przy zmianie waiting → accepted
  IF NEW.status = 'accepted' AND OLD.status = 'waiting' THEN
    -- Pobierz rolę akceptującego
    SELECT role INTO v_approver_role
    FROM profiles
    WHERE id = auth.uid();

    -- Dyrektor musi sprawdzić osobiste limity (suma wszystkich działów)
    IF v_approver_role = 'dyrektor' THEN
      -- Pobierz osobisty limit dyrektora
      SELECT director_approval_limit INTO v_director_limit
      FROM profiles
      WHERE id = auth.uid();

      -- Jeśli jest limit, sprawdź czy nie został przekroczony
      IF v_director_limit IS NOT NULL THEN
        -- Oblicz sumę zaakceptowanych faktur we wszystkich działach dyrektora w tym miesiącu
        SELECT COALESCE(SUM(pln_gross_amount), 0) INTO v_current_month_total
        FROM invoices
        WHERE status IN ('accepted', 'paid')
          AND current_approver_id = auth.uid()
          AND department_id IN (
            SELECT id FROM departments WHERE director_id = auth.uid()
          )
          AND EXTRACT(MONTH FROM created_at) = EXTRACT(MONTH FROM CURRENT_DATE)
          AND EXTRACT(YEAR FROM created_at) = EXTRACT(YEAR FROM CURRENT_DATE);

        -- Jeśli przekroczy limit, przekaż do CEO
        IF (v_current_month_total + NEW.pln_gross_amount) > v_director_limit THEN
          SELECT id INTO v_ceo_id FROM profiles WHERE role = 'ceo' LIMIT 1;
          
          IF v_ceo_id IS NOT NULL THEN
            -- Przekaż do CEO zamiast akceptować
            NEW.status := 'waiting';
            NEW.current_approver_id := v_ceo_id;
            
            INSERT INTO audit_logs (invoice_id, user_id, action, details)
            VALUES (
              NEW.id,
              auth.uid(),
              'forwarded_to_ceo',
              'Faktura przekazana do CEO - przekroczono limity dyrektora'
            );
            
            RETURN NEW;
          END IF;
        END IF;
      END IF;

      -- W limitach lub brak CEO - zaakceptuj
      NEW.current_approver_id := NULL;
      NEW.approved_by_director_at := NOW();
    
    -- Kierownik
    ELSIF v_approver_role = 'kierownik' THEN
      NEW.current_approver_id := NULL;
      NEW.approved_by_manager_at := NOW();
    
    -- CEO/Admin
    ELSIF v_approver_role IN ('ceo', 'admin') THEN
      NEW.current_approver_id := NULL;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Utwórz trigger
CREATE TRIGGER on_simple_invoice_approval
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION handle_simple_invoice_approval();

-- ============================================================================
-- KROK 5: Zaktualizuj polityki UPDATE
-- ============================================================================

-- Usuń stare polityki
DROP POLICY IF EXISTS "Users can approve invoices assigned to them with limits" ON invoices;
DROP POLICY IF EXISTS "Director can approve within personal limits" ON invoices;
DROP POLICY IF EXISTS "Users can approve invoices with simplified flow" ON invoices;

-- Polityka dla akceptacji
CREATE POLICY "Allow approval by current approver"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    current_approver_id = auth.uid()
    AND status = 'waiting'
  )
  WITH CHECK (true); -- Funkcja trigger zajmie się sprawdzaniem limitów
