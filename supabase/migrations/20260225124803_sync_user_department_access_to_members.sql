/*
  # Synchronizacja user_department_access z department_members

  ## Opis
  Gdy użytkownik jest dodawany do `user_department_access` (obieg dokumentów),
  powinien automatycznie pojawić się też w `department_members` tego działu —
  żeby był widoczny w schemacie struktury organizacyjnej.

  ## Zmiany
  1. Trigger `sync_access_to_department_members` na INSERT do `user_department_access`
  2. Trigger `remove_access_from_department_members` na DELETE z `user_department_access`
     — usuwa z department_members tylko jeśli nie jest tam z innego powodu
  3. Backfill istniejących wpisów
*/

CREATE OR REPLACE FUNCTION sync_access_to_department_members()
RETURNS trigger AS $$
BEGIN
  INSERT INTO department_members (department_id, user_id, assigned_by)
  VALUES (NEW.department_id, NEW.user_id, NEW.granted_by)
  ON CONFLICT (department_id, user_id) DO NOTHING;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_access_to_department_members_trigger ON user_department_access;
CREATE TRIGGER sync_access_to_department_members_trigger
  AFTER INSERT ON user_department_access
  FOR EACH ROW
  EXECUTE FUNCTION sync_access_to_department_members();

CREATE OR REPLACE FUNCTION remove_access_from_department_members()
RETURNS trigger AS $$
BEGIN
  DELETE FROM department_members
  WHERE department_id = OLD.department_id
    AND user_id = OLD.user_id;
  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS remove_access_from_department_members_trigger ON user_department_access;
CREATE TRIGGER remove_access_from_department_members_trigger
  AFTER DELETE ON user_department_access
  FOR EACH ROW
  EXECUTE FUNCTION remove_access_from_department_members();

-- Backfill istniejących wpisów
INSERT INTO department_members (department_id, user_id, assigned_by)
SELECT uda.department_id, uda.user_id, uda.granted_by
FROM user_department_access uda
ON CONFLICT (department_id, user_id) DO NOTHING;
