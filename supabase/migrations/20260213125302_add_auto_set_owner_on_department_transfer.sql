/*
  # Automatyczne ustawianie właściciela przy transferze między działami

  ## Problem

  Gdy użytkownik przesyła fakturę do innego działu:
  1. Faktura powinna automatycznie dostać właściciela (current_approver_id)
  2. Status powinien być 'draft' (nie 'waiting') żeby nie wliczała się jako "w procesie"
  3. Właściciel powinien być kierownikiem działu lub dyrektorem jeśli nie ma kierownika

  ## Rozwiązanie

  1. Dodaj funkcję która automatycznie znajduje kierownika lub dyrektora działu
  2. Dodaj trigger który automatycznie ustawia właściciela przy zmianie działu
  3. Jeśli faktura jest transferowana do innego działu, status pozostaje 'draft'

  ## Zmiany

  1. Nowa funkcja `auto_set_invoice_owner()`
     - Znajduje kierownika działu (role = 'Kierownik')
     - Jeśli nie ma kierownika, znajduje dyrektora (role = 'Dyrektor')  
     - Ustawia current_approver_id na znalezioną osobę

  2. Nowy trigger `auto_set_owner_on_department_change`
     - Wywołuje się gdy zmienia się department_id
     - Automatycznie ustawia właściciela jeśli nie jest już ustawiony
*/

-- Funkcja do automatycznego ustawiania właściciela faktury
CREATE OR REPLACE FUNCTION auto_set_invoice_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  -- Tylko jeśli zmienił się dział i nie ma jeszcze ustawionego właściciela
  IF (TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id) 
     OR (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.current_approver_id IS NULL) THEN
    
    -- Najpierw szukaj kierownika działu
    SELECT p.id INTO v_manager_id
    FROM profiles p
    WHERE p.department_id = NEW.department_id
    AND p.role = 'Kierownik'
    LIMIT 1;

    IF v_manager_id IS NOT NULL THEN
      NEW.current_approver_id := v_manager_id;
    ELSE
      -- Jeśli nie ma kierownika, szukaj dyrektora
      SELECT p.id INTO v_director_id
      FROM profiles p
      WHERE p.department_id = NEW.department_id
      AND p.role = 'Dyrektor'
      LIMIT 1;

      IF v_director_id IS NOT NULL THEN
        NEW.current_approver_id := v_director_id;
      END IF;
    END IF;

    -- Jeśli zmienia się dział (transfer), ustaw status na draft
    -- żeby faktura nie była liczona jako "w procesie" u poprzedniego właściciela
    IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      NEW.status := 'draft';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Utwórz trigger który automatycznie ustawia właściciela
DROP TRIGGER IF EXISTS auto_set_owner_on_department_change ON invoices;

CREATE TRIGGER auto_set_owner_on_department_change
  BEFORE INSERT OR UPDATE OF department_id, current_approver_id
  ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_set_invoice_owner();

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia właściciela faktury (current_approver_id) na kierownika lub dyrektora działu przy zmianie department_id. Status jest ustawiany na draft przy transferze między działami.';
