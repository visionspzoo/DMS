/*
  # Poprawka obiegu akceptacji faktur i widoczności

  ## Zmiany w obiegu dokumentów
  
  Nowy przepływ akceptacji:
  - Specjalista (dział) -> Kierownik (dział) [jeśli istnieje] -> Dyrektor (dział) [jeśli istnieje]
  - Kroki są pomijane jeśli nie ma kierownika/dyrektora w danym dziale
  
  ## Nowa widoczność faktur
  
  1. **Specjaliści**
     - Widzą TYLKO swoje faktury, które sami dodali/pobrali
     - Widzą tylko faktury ze swojego działu
  
  2. **Kierownicy**
     - Widzą swoje faktury
     - Widzą faktury swoich podwładnych (specjalistów) z tego samego działu
     - Nie widzą faktur kierowników i dyrektorów
  
  3. **Dyrektorzy**
     - Widzą swoje faktury
     - Widzą faktury swoich podwładnych (specjalistów i kierowników)
     - Widzą faktury z działów podrzędnych (całe drzewo hierarchii)
  
  4. **CEO**
     - Widzi wszystkie faktury ze wszystkich działów
  
  ## Funkcje pomocnicze
  
  - `get_next_approver_in_department(dept_id, user_role)` - zwraca ID następnego akceptującego w hierarchii działu
  
  ## Bezpieczeństwo
  
  - RLS wymusza ścisłą kontrolę dostępu według roli
  - Specjaliści nie widzą faktur innych użytkowników
  - Każda rola ma jasno określony zakres widoczności
*/

-- Usuń istniejącą policy
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Nowa policy z poprawioną widocznością
CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- Admini widzą wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEO widzi wszystkie faktury
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Dyrektor widzi faktury z całego drzewa działów podrzędnych + swoje
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND (
        -- Własne faktury
        uploaded_by = auth.uid()
        OR
        -- Faktury z działu i działów podrzędnych
        EXISTS (
          SELECT 1 FROM invoice_departments id
          WHERE id.invoice_id = invoices.id
          AND id.department_id IN (
            WITH RECURSIVE dept_tree AS (
              -- Dział dyrektora
              SELECT d.id FROM departments d
              WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
              
              UNION ALL
              
              -- Wszystkie działy podrzędne
              SELECT d.id FROM departments d
              JOIN dept_tree dt ON d.parent_department_id = dt.id
            )
            SELECT id FROM dept_tree
          )
        )
      )
    )
    OR
    -- Kierownik widzi swoje faktury + faktury specjalistów ze swojego działu
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND (
        -- Własne faktury
        uploaded_by = auth.uid()
        OR
        -- Faktury specjalistów z tego samego działu
        (
          EXISTS (
            SELECT 1 FROM invoice_departments id
            JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND uploader.role = 'Specjalista'
          )
        )
      )
    )
    OR
    -- Specjalista widzi TYLKO własne faktury
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND uploaded_by = auth.uid()
    )
  );

-- Funkcja pomocnicza do znajdowania następnego akceptującego w dziale
-- Zwraca ID użytkownika który powinien zaakceptować fakturę
CREATE OR REPLACE FUNCTION get_next_approver_in_department(dept_id uuid, user_role text)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  next_approver_id uuid;
  dept_manager_id uuid;
  dept_director_id uuid;
  parent_dept_id uuid;
BEGIN
  -- Pobierz managera i parent działu
  SELECT manager_id, parent_department_id INTO dept_manager_id, parent_dept_id
  FROM departments
  WHERE id = dept_id;
  
  -- Jeśli aktualny użytkownik to Specjalista, szukaj Kierownika w dziale
  IF user_role = 'Specjalista' THEN
    -- Sprawdź czy jest kierownik w tym dziale
    SELECT p.id INTO next_approver_id
    FROM profiles p
    WHERE p.department_id = dept_id
    AND p.role = 'Kierownik'
    LIMIT 1;
    
    IF next_approver_id IS NOT NULL THEN
      RETURN next_approver_id;
    END IF;
  END IF;
  
  -- Jeśli nie ma kierownika lub aktualny to Kierownik, szukaj Dyrektora
  IF user_role IN ('Specjalista', 'Kierownik') THEN
    -- Sprawdź czy jest dyrektor w tym dziale
    SELECT p.id INTO next_approver_id
    FROM profiles p
    WHERE p.department_id = dept_id
    AND p.role = 'Dyrektor'
    LIMIT 1;
    
    IF next_approver_id IS NOT NULL THEN
      RETURN next_approver_id;
    END IF;
  END IF;
  
  -- Jeśli nie ma dyrektora lub aktualny to Dyrektor, szukaj CEO
  SELECT p.id INTO next_approver_id
  FROM profiles p
  WHERE p.role = 'CEO'
  LIMIT 1;
  
  RETURN next_approver_id;
END;
$$;

-- Funkcja do automatycznego ustawienia statusu faktury po załadowaniu
-- Jeśli specjalista dodaje fakturę, automatycznie ustawia status 'waiting' i przypisuje do kierownika
CREATE OR REPLACE FUNCTION auto_assign_invoice_to_approver()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  uploader_role text;
  uploader_dept_id uuid;
  next_approver_id uuid;
BEGIN
  -- Pobierz rolę i dział uploadującego
  SELECT role, department_id INTO uploader_role, uploader_dept_id
  FROM profiles
  WHERE id = NEW.uploaded_by;
  
  -- Jeśli uploader to Specjalista i status to 'draft', zmień na 'waiting'
  IF uploader_role = 'Specjalista' AND NEW.status = 'draft' THEN
    -- Znajdź następnego akceptującego
    next_approver_id := get_next_approver_in_department(uploader_dept_id, uploader_role);
    
    -- Jeśli znaleziono następnego akceptującego, ustaw status 'waiting'
    IF next_approver_id IS NOT NULL THEN
      NEW.status := 'waiting';
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Trigger do automatycznego przypisywania faktur do akceptującego
DROP TRIGGER IF EXISTS auto_assign_invoice_trigger ON invoices;

CREATE TRIGGER auto_assign_invoice_trigger
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_invoice_to_approver();

-- Indeksy dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_profiles_role_department ON profiles(role, department_id);
CREATE INDEX IF NOT EXISTS idx_invoices_uploaded_by ON invoices(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
