/*
  # Automatyczne przypisywanie działów do faktur

  ## 1. Nowa tabela
    - `invoice_departments` - tabela pośrednia przechowująca wiele działów dla każdej faktury
      - `id` (uuid, primary key)
      - `invoice_id` (uuid, foreign key do invoices)
      - `department_id` (uuid, foreign key do departments)
      - `is_primary` (boolean) - czy to główny dział (dział użytkownika)
      - `created_at` (timestamp)

  ## 2. Funkcja rekurencyjna
    - `get_department_hierarchy(dept_id uuid)` - zwraca dział i wszystkie działy nadrzędne
  
  ## 3. Trigger
    - Automatycznie przypisuje dział użytkownika i wszystkie działy nadrzędne przy tworzeniu faktury
    - Trigger uruchamia się po INSERT na tabeli invoices
  
  ## 4. Bezpieczeństwo
    - RLS włączony na invoice_departments
    - Policy pozwalająca użytkownikom uwierzytelnionym na odczyt
    - Policy pozwalająca tylko uploaderom na modyfikację
*/

-- Tabela pośrednia dla wielu działów na fakturze
CREATE TABLE IF NOT EXISTS invoice_departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  is_primary boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(invoice_id, department_id)
);

-- Włącz RLS
ALTER TABLE invoice_departments ENABLE ROW LEVEL SECURITY;

-- Policy dla odczytu - wszyscy uwierzytelnieni użytkownicy
CREATE POLICY "Users can view invoice departments"
  ON invoice_departments FOR SELECT
  TO authenticated
  USING (true);

-- Policy dla wstawiania - tylko uploader faktury
CREATE POLICY "Uploader can assign departments"
  ON invoice_departments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_departments.invoice_id
      AND invoices.uploaded_by = auth.uid()
    )
  );

-- Policy dla usuwania - tylko uploader faktury
CREATE POLICY "Uploader can remove departments"
  ON invoice_departments FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM invoices
      WHERE invoices.id = invoice_departments.invoice_id
      AND invoices.uploaded_by = auth.uid()
    )
  );

-- Funkcja rekurencyjna zwracająca hierarchię działów (dział + wszystkie działy nadrzędne)
CREATE OR REPLACE FUNCTION get_department_hierarchy(dept_id uuid)
RETURNS TABLE (department_id uuid, level int) AS $$
BEGIN
  RETURN QUERY
  WITH RECURSIVE dept_hierarchy AS (
    -- Bazowy przypadek: wybrany dział (poziom 0)
    SELECT 
      d.id as department_id,
      0 as level
    FROM departments d
    WHERE d.id = dept_id
    
    UNION ALL
    
    -- Rekurencja: działy nadrzędne (poziom +1)
    SELECT 
      d.id as department_id,
      dh.level + 1 as level
    FROM departments d
    INNER JOIN dept_hierarchy dh ON d.id = (
      SELECT parent_department_id 
      FROM departments 
      WHERE id = dh.department_id
    )
  )
  SELECT * FROM dept_hierarchy
  ORDER BY level ASC;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Funkcja automatycznie przypisująca działy do faktury
CREATE OR REPLACE FUNCTION auto_assign_invoice_departments()
RETURNS TRIGGER AS $$
DECLARE
  user_dept_id uuid;
  dept_record record;
BEGIN
  -- Pobierz department_id użytkownika tworzącego fakturę
  SELECT department_id INTO user_dept_id
  FROM profiles
  WHERE id = NEW.uploaded_by;
  
  -- Jeśli użytkownik ma przypisany dział
  IF user_dept_id IS NOT NULL THEN
    -- Przypisz główny dział do faktury (dla kompatybilności wstecznej)
    UPDATE invoices 
    SET department_id = user_dept_id 
    WHERE id = NEW.id;
    
    -- Przypisz dział użytkownika i wszystkie działy nadrzędne do invoice_departments
    FOR dept_record IN 
      SELECT department_id, level 
      FROM get_department_hierarchy(user_dept_id)
    LOOP
      INSERT INTO invoice_departments (invoice_id, department_id, is_primary)
      VALUES (
        NEW.id, 
        dept_record.department_id, 
        dept_record.level = 0  -- Główny dział (poziom 0)
      )
      ON CONFLICT (invoice_id, department_id) DO NOTHING;
    END LOOP;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Trigger uruchamiający automatyczne przypisanie działów
DROP TRIGGER IF EXISTS trigger_auto_assign_invoice_departments ON invoices;
CREATE TRIGGER trigger_auto_assign_invoice_departments
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_invoice_departments();
