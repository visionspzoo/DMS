/*
  # Automatyczne dodawanie dyrektora do department_members

  ## Opis
  Gdy `director_id` jest ustawiany lub zmieniany w tabeli `departments`,
  nowy dyrektor jest automatycznie dodawany do `department_members` dla tego działu.

  ## Zmiany
  1. Trigger `sync_director_to_department_members` na tabeli `departments`
     - Uruchamia się po INSERT i UPDATE
     - Jeśli `director_id` jest ustawiony i nie istnieje jeszcze wpis w `department_members`, wstawia go
     - Używa `assigned_by = director_id` (auto-assign)

  ## Uwagi
  - Nie usuwa poprzedniego dyrektora z `department_members` (może pozostać jako "dyrektor w obiegu")
  - Używa ON CONFLICT DO NOTHING (UNIQUE constraint na department_id, user_id)
*/

CREATE OR REPLACE FUNCTION sync_director_to_department_members()
RETURNS trigger AS $$
BEGIN
  IF NEW.director_id IS NOT NULL THEN
    INSERT INTO department_members (department_id, user_id, assigned_by)
    VALUES (NEW.id, NEW.director_id, NEW.director_id)
    ON CONFLICT (department_id, user_id) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS sync_director_to_department_members_trigger ON departments;
CREATE TRIGGER sync_director_to_department_members_trigger
  AFTER INSERT OR UPDATE OF director_id ON departments
  FOR EACH ROW
  EXECUTE FUNCTION sync_director_to_department_members();
