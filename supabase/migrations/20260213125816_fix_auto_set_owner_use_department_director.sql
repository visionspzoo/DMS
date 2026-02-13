/*
  # Naprawa automatycznego ustawiania właściciela - używaj director_id z departments

  ## Problem
  
  Poprzedni trigger szukał dyrektora wśród użytkowników gdzie department_id = dział AND role = 'Dyrektor'.
  To jest błędne podejście, ponieważ:
  - Dyrektor może nie mieć ustawionego department_id na dany dział
  - Tabela departments ma pole director_id które wskazuje bezpośrednio na dyrektora

  ## Rozwiązanie
  
  1. Najpierw sprawdź manager_id w tabeli departments
  2. Jeśli nie ma kierownika, weź director_id z tabeli departments
  3. Ustaw current_approver_id na znalezioną osobę

  ## Zmiany
  
  - Funkcja `auto_set_invoice_owner()` pobiera manager_id i director_id bezpośrednio z tabeli departments
  - Używa manager_id jako pierwszego wyboru
  - Używa director_id jako drugiego wyboru jeśli nie ma kierownika
*/

-- Zaktualizowana funkcja do automatycznego ustawiania właściciela faktury
CREATE OR REPLACE FUNCTION auto_set_invoice_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  -- Tylko jeśli zmienił się dział lub jeśli to nowa faktura z działem
  IF (TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id) 
     OR (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.current_approver_id IS NULL) THEN
    
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

    -- Jeśli zmienia się dział (transfer), ustaw status na draft
    -- żeby faktura nie była liczona jako "w procesie" u poprzedniego właściciela
    IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      NEW.status := 'draft';
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia właściciela faktury (current_approver_id) na kierownika (manager_id) lub dyrektora (director_id) z tabeli departments. Status jest ustawiany na draft przy transferze między działami.';
