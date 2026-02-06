/*
  # Zmiana pola department na UUID i synchronizacja z department_members

  1. Zmiany w profiles
    - Zmienia pole `department` z TEXT na UUID
    - Dodaje klucz obcy do tabeli departments
    - Migruje istniejące dane tekstowe na UUID
  
  2. Synchronizacja
    - Synchronizuje dane między profiles.department a department_members
    - Dodaje triggery do automatycznej synchronizacji
  
  3. Bezpieczeństwo
    - Zachowuje istniejące dane
    - Dodaje triggery do automatycznej synchronizacji
*/

-- Najpierw utwórz nową kolumnę department_id jako UUID
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE profiles ADD COLUMN department_id UUID REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Migruj istniejące dane - dopasuj nazwy działów do UUID
UPDATE profiles p
SET department_id = d.id
FROM departments d
WHERE p.department = d.name
AND p.department IS NOT NULL
AND p.department_id IS NULL;

-- Synchronizuj z department_members - dodaj brakujące wpisy
INSERT INTO department_members (department_id, user_id, assigned_by)
SELECT 
  p.department_id,
  p.id,
  p.id
FROM profiles p
WHERE p.department_id IS NOT NULL
AND NOT EXISTS (
  SELECT 1 FROM department_members dm
  WHERE dm.user_id = p.id AND dm.department_id = p.department_id
)
ON CONFLICT DO NOTHING;

-- Usuń stare pole department (tekstowe)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'department'
  ) THEN
    ALTER TABLE profiles DROP COLUMN department;
  END IF;
END $$;

-- Funkcja do synchronizacji profiles.department_id -> department_members
CREATE OR REPLACE FUNCTION sync_profile_department_to_members()
RETURNS TRIGGER AS $$
BEGIN
  -- Usuń stare przypisanie
  IF OLD.department_id IS NOT NULL AND OLD.department_id != NEW.department_id THEN
    DELETE FROM department_members
    WHERE user_id = OLD.id AND department_id = OLD.department_id;
  END IF;

  -- Dodaj nowe przypisanie
  IF NEW.department_id IS NOT NULL THEN
    INSERT INTO department_members (department_id, user_id, assigned_by)
    VALUES (NEW.department_id, NEW.id, NEW.id)
    ON CONFLICT (user_id, department_id) DO NOTHING;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger dla UPDATE profiles
DROP TRIGGER IF EXISTS sync_profile_department_update ON profiles;
CREATE TRIGGER sync_profile_department_update
  AFTER UPDATE OF department_id ON profiles
  FOR EACH ROW
  WHEN (OLD.department_id IS DISTINCT FROM NEW.department_id)
  EXECUTE FUNCTION sync_profile_department_to_members();

-- Trigger dla INSERT profiles
DROP TRIGGER IF EXISTS sync_profile_department_insert ON profiles;
CREATE TRIGGER sync_profile_department_insert
  AFTER INSERT ON profiles
  FOR EACH ROW
  WHEN (NEW.department_id IS NOT NULL)
  EXECUTE FUNCTION sync_profile_department_to_members();

-- Funkcja do synchronizacji department_members -> profiles.department_id
CREATE OR REPLACE FUNCTION sync_members_to_profile_department()
RETURNS TRIGGER AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Przy dodaniu do department_members, zaktualizuj profiles
    UPDATE profiles
    SET department_id = NEW.department_id
    WHERE id = NEW.user_id
    AND (department_id IS NULL OR department_id != NEW.department_id);
    
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    -- Przy usunięciu z department_members, wyczyść profiles jeśli to jedyne przypisanie
    IF NOT EXISTS (
      SELECT 1 FROM department_members
      WHERE user_id = OLD.user_id AND department_id = OLD.department_id
    ) THEN
      UPDATE profiles
      SET department_id = NULL
      WHERE id = OLD.user_id AND department_id = OLD.department_id;
    END IF;
    
    RETURN OLD;
  END IF;
  
  RETURN NULL;
END;
$$ LANGUAGE plpgsql;

-- Trigger dla department_members
DROP TRIGGER IF EXISTS sync_members_insert ON department_members;
CREATE TRIGGER sync_members_insert
  AFTER INSERT ON department_members
  FOR EACH ROW
  EXECUTE FUNCTION sync_members_to_profile_department();

DROP TRIGGER IF EXISTS sync_members_delete ON department_members;
CREATE TRIGGER sync_members_delete
  AFTER DELETE ON department_members
  FOR EACH ROW
  EXECUTE FUNCTION sync_members_to_profile_department();
