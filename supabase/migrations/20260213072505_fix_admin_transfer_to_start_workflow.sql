/*
  # Naprawa Transferu Faktur przez Administratora
  
  ## Problem
  - Kiedy Administrator przekazuje fakturę do działu, funkcja get_next_approver_in_department
    nie obsługuje roli 'Administrator'
  - W rezultacie funkcja przeskakuje do CEO zamiast przypisać fakturę do Kierownika działu
  
  ## Rozwiązanie
  - Zaktualizuj funkcję get_next_approver_in_department
  - Dodaj obsługę NULL lub pustego user_role
  - Dla NULL/empty zawsze rozpoczynaj workflow od początku (Kierownik działu)
  
  ## Przypadki użycia
  - Administrator przekazuje fakturę → powinna trafić do Kierownika działu
  - Specjalista przekazuje fakturę → powinna trafić do Kierownika działu
  - Kierownik zatwierdza → powinna trafić do Dyrektora
  - Dyrektor zatwierdza → powinna trafić do CEO
*/

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
  
  -- Jeśli user_role jest NULL, empty lub 'Administrator', rozpocznij workflow od początku (Kierownik)
  -- To samo dla 'Specjalista'
  IF user_role IS NULL OR user_role = '' OR user_role IN ('Administrator', 'Specjalista') THEN
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
    
    -- Jeśli nie ma kierownika, szukaj dyrektora
    SELECT p.id INTO next_approver_id
    FROM profiles p
    WHERE p.department_id = dept_id
    AND p.role = 'Dyrektor'
    LIMIT 1;
    
    IF next_approver_id IS NOT NULL THEN
      RETURN next_approver_id;
    END IF;
  END IF;
  
  -- Jeśli aktualny użytkownik to Kierownik, szukaj Dyrektora
  IF user_role = 'Kierownik' THEN
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
