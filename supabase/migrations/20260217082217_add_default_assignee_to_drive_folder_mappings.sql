/*
  # Dodaj domyślnego przypisanego użytkownika dla faktur z Google Drive

  ## Problem

  Obecnie faktury pobrane z Google Drive są automatycznie przypisywane do:
  - Kierownika działu (jeśli istnieje)
  - Dyrektora działu (jeśli nie ma kierownika)

  Ale użytkownicy nie mogą wybrać konkretnej osoby w dziale, do której faktury
  z danego folderu powinny być domyślnie przypisane.

  ## Rozwiązanie

  Dodaj pole `default_assignee_id` do `user_drive_folder_mappings`:
  - Pozwala użytkownikowi wybrać konkretną osobę w dziale
  - Jeśli ustawione, faktury z tego folderu będą przypisane do tej osoby
  - Jeśli NULL, używa domyślnej logiki (kierownik → dyrektor)

  ## Zmiany

  1. Dodaj kolumnę `default_assignee_id` (nullable, references profiles)
  2. Dodaj trigger sprawdzający że assignee należy do tego samego działu
  3. Dokumentacja do użycia w Edge Functions pobierających faktury z Drive
*/

-- Dodaj kolumnę default_assignee_id
ALTER TABLE user_drive_folder_mappings
ADD COLUMN IF NOT EXISTS default_assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

-- Dodaj indeks dla wydajności
CREATE INDEX IF NOT EXISTS idx_drive_folder_mappings_assignee 
ON user_drive_folder_mappings(default_assignee_id);

-- Funkcja sprawdzająca że assignee należy do działu
CREATE OR REPLACE FUNCTION validate_folder_mapping_assignee()
RETURNS TRIGGER AS $$
DECLARE
  v_assignee_dept_id uuid;
BEGIN
  -- Jeśli default_assignee_id jest NULL, nie ma co sprawdzać
  IF NEW.default_assignee_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- Pobierz department_id przypisanej osoby
  SELECT department_id INTO v_assignee_dept_id
  FROM profiles
  WHERE id = NEW.default_assignee_id;

  -- Sprawdź czy assignee należy do tego samego działu
  IF v_assignee_dept_id IS NULL THEN
    RAISE EXCEPTION 'Wybrany użytkownik nie ma przypisanego działu';
  END IF;

  IF v_assignee_dept_id != NEW.department_id THEN
    RAISE EXCEPTION 'Wybrany użytkownik (%) nie należy do działu (%)', 
      NEW.default_assignee_id, NEW.department_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger walidujący
DROP TRIGGER IF EXISTS validate_folder_mapping_assignee_trigger ON user_drive_folder_mappings;

CREATE TRIGGER validate_folder_mapping_assignee_trigger
  BEFORE INSERT OR UPDATE OF default_assignee_id, department_id
  ON user_drive_folder_mappings
  FOR EACH ROW
  EXECUTE FUNCTION validate_folder_mapping_assignee();

COMMENT ON COLUMN user_drive_folder_mappings.default_assignee_id IS
'ID użytkownika w dziale, do którego faktury z tego folderu powinny być domyślnie przypisane.
Jeśli NULL, używa domyślnej logiki: kierownik działu → dyrektor działu.
Musi należeć do tego samego działu co department_id.';

COMMENT ON FUNCTION validate_folder_mapping_assignee IS
'Sprawdza czy default_assignee_id należy do tego samego działu co department_id w mapowaniu folderu Google Drive.';
