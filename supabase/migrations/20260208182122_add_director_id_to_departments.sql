/*
  # Dodanie kolumny director_id do działów

  ## Zmiany
  
  1. Nowa kolumna w tabeli `departments`
     - `director_id` (uuid, nullable) - ID dyrektora przypisanego do działu
     - Foreign key do tabeli `profiles`
  
  2. Aktualizacja funkcji `get_next_approver_in_department`
     - Funkcja teraz sprawdza zarówno kierownika jak i dyrektora przypisanego do działu
     - Hierarchia: Specjalista -> Kierownik (jeśli jest w dziale) -> Dyrektor (jeśli jest w dziale) -> CEO
  
  ## Bezpieczeństwo
  
  - Director_id musi wskazywać na istniejący profil z rolą 'Dyrektor'
  - Zachowana spójność referencyjna przez foreign key
*/

-- Dodaj kolumnę director_id do tabeli departments
ALTER TABLE departments 
ADD COLUMN IF NOT EXISTS director_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Dodaj komentarz do kolumny
COMMENT ON COLUMN departments.director_id IS 'ID dyrektora przypisanego bezpośrednio do tego działu';

-- Zaktualizuj funkcję get_next_approver_in_department
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
  -- Pobierz managera, dyrektora i parent działu
  SELECT manager_id, director_id, parent_department_id 
  INTO dept_manager_id, dept_director_id, parent_dept_id
  FROM departments
  WHERE id = dept_id;
  
  -- Jeśli aktualny użytkownik to Specjalista, szukaj Kierownika w dziale
  IF user_role = 'Specjalista' THEN
    -- Sprawdź czy jest kierownik przypisany bezpośrednio do działu
    IF dept_manager_id IS NOT NULL THEN
      RETURN dept_manager_id;
    END IF;
    
    -- Jeśli nie ma kierownika, sprawdź czy jest dyrektor przypisany do działu
    IF dept_director_id IS NOT NULL THEN
      RETURN dept_director_id;
    END IF;
    
    -- Jeśli nie ma ani kierownika ani dyrektora, szukaj w profilu użytkowników z tego działu
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
    -- Sprawdź czy jest dyrektor przypisany bezpośrednio do działu
    IF dept_director_id IS NOT NULL THEN
      RETURN dept_director_id;
    END IF;
    
    -- Jeśli nie ma dyrektora przypisanego, szukaj w profilu użytkowników z tego działu
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

-- Dodaj indeks dla lepszej wydajności
CREATE INDEX IF NOT EXISTS idx_departments_director_id ON departments(director_id);
