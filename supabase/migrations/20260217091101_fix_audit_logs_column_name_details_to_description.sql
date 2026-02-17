/*
  # Naprawa triggera log_invoice_update - zmiana kolumny details na description
  
  ## Problem
  Trigger log_invoice_update() używa kolumny "details", ale tabela audit_logs ma kolumnę "description".
  
  ## Rozwiązanie
  Zaktualizuj funkcję log_invoice_update() aby używała właściwych kolumn:
  - user_id zamiast changed_by
  - description zamiast details
*/

CREATE OR REPLACE FUNCTION log_invoice_update()
RETURNS TRIGGER AS $$
DECLARE
  old_status_text text;
  new_status_text text;
  actor_name text;
  old_approver_name text;
  new_approver_name text;
BEGIN
  -- Mapuj statusy na czytelny tekst
  old_status_text := CASE OLD.status
    WHEN 'draft' THEN 'Wersja robocza'
    WHEN 'waiting' THEN 'Oczekuje'
    WHEN 'accepted' THEN 'Zaakceptowana'
    WHEN 'paid' THEN 'Opłacona'
    ELSE OLD.status
  END;

  new_status_text := CASE NEW.status
    WHEN 'draft' THEN 'Wersja robocza'
    WHEN 'waiting' THEN 'Oczekuje'
    WHEN 'accepted' THEN 'Zaakceptowana'
    WHEN 'paid' THEN 'Opłacona'
    ELSE NEW.status
  END;

  -- Pobierz nazwę użytkownika
  SELECT full_name INTO actor_name FROM profiles WHERE id = auth.uid();

  -- Pobierz nazwiska osób zatwierdzających
  IF OLD.current_approver_id IS NOT NULL THEN
    SELECT full_name INTO old_approver_name FROM profiles WHERE id = OLD.current_approver_id;
  END IF;

  IF NEW.current_approver_id IS NOT NULL THEN
    SELECT full_name INTO new_approver_name FROM profiles WHERE id = NEW.current_approver_id;
  END IF;

  -- Loguj zmianę statusu
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, description)
    VALUES (
      NEW.id,
      auth.uid(),
      'status_change',
      format('Zmiana statusu z "%s" na "%s" przez %s', old_status_text, new_status_text, COALESCE(actor_name, 'system'))
    );
  END IF;

  -- Loguj zmianę current_approver_id
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, description)
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
    INSERT INTO audit_logs (invoice_id, user_id, action, description)
    VALUES (
      NEW.id,
      auth.uid(),
      'department_change',
      format('Zmiana działu')
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
