/*
  # Naprawa: Respektuj wybór użytkownika przy transferze faktury

  ## Problem
  
  Gdy użytkownik wybiera konkretną osobę podczas transferu faktury do innego działu,
  trigger `auto_set_invoice_owner()` nadpisuje ten wybór i automatycznie ustawia
  kierownika lub dyrektora z tabeli departments.

  ## Przykład problemu
  
  1. Użytkownik przesyła fakturę "Zaakceptowaną" do działu Ecommerce
  2. Wybiera "Kierownik" jako osobę docelową
  3. Frontend wykonuje UPDATE z department_id = Ecommerce i current_approver_id = [ID kierownika]
  4. Trigger widzi zmianę department_id i nadpisuje current_approver_id na dyrektora
  5. Faktura trafia do Dyrektora zamiast do Kierownika

  ## Rozwiązanie
  
  Trigger powinien sprawdzić czy użytkownik już wybrał konkretną osobę podczas UPDATE.
  Jeśli użytkownik zmienił current_approver_id podczas tego samego UPDATE co zmienia department_id,
  to oznacza że użytkownik świadomie wybrał konkretną osobę i trigger nie powinien tego nadpisywać.

  ## Zmiany
  
  - Funkcja sprawdza czy użytkownik ustawił current_approver_id podczas UPDATE
  - Jeśli TAK (OLD.current_approver_id != NEW.current_approver_id), trigger nie nadpisuje wyboru
  - Jeśli NIE (current_approver_id się nie zmienił), trigger automatycznie ustawia kierownika/dyrektora
*/

-- Zaktualizowana funkcja która respektuje wybór użytkownika
CREATE OR REPLACE FUNCTION auto_set_invoice_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
  v_user_changed_approver boolean := false;
BEGIN
  -- Sprawdź czy użytkownik świadomie zmienił current_approver_id podczas tego UPDATE
  IF TG_OP = 'UPDATE' THEN
    v_user_changed_approver := (OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id);
  END IF;

  -- Automatycznie ustaw właściciela TYLKO jeśli:
  -- 1. To jest INSERT z działem ale bez właściciela, LUB
  -- 2. To jest UPDATE który zmienia dział, ALE użytkownik NIE wybrał konkretnej osoby
  IF (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.current_approver_id IS NULL)
     OR (TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id AND NOT v_user_changed_approver) THEN
    
    -- Pobierz manager_id i director_id bezpośrednio z tabeli departments
    SELECT manager_id, director_id
    INTO v_manager_id, v_director_id
    FROM departments
    WHERE id = NEW.department_id;

    -- Najpierw próbuj ustawić kierownika
    IF v_manager_id IS NOT NULL THEN
      NEW.current_approver_id := v_manager_id;
    -- Jeśli nie ma kierownika, ustaw dyrektora
    ELSIF v_director_id IS NOT NULL THEN
      NEW.current_approver_id := v_director_id;
    END IF;
  END IF;

  -- Jeśli zmienia się dział (transfer), ustaw status na draft
  IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
    NEW.status := 'draft';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia właściciela faktury TYLKO jeśli użytkownik nie wybrał konkretnej osoby. Respektuje wybór użytkownika podczas transferu między działami.';
