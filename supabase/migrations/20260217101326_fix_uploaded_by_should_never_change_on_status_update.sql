/*
  # Napraw logikę uploaded_by - nie powinien się zmieniać automatycznie

  ## Problem

  Obecnie trigger `auto_set_invoice_owner()`:
  1. Przy INSERT ustawia `uploaded_by` na kierownika działu (nieprawidłowo!)
  2. To powoduje, że gdy Kierownik dodaje fakturę, widzi że faktura należy do kogoś innego
  3. Przy wysyłaniu faktury do akceptacji, właściciel faktury się zmienia

  ## Rozwiązanie

  1. `uploaded_by` powinien ZAWSZE być osobą która dodała fakturę (nie kierownikiem działu)
  2. Trigger NIE POWINIEN zmieniać `uploaded_by` przy INSERT
  3. `uploaded_by` zmienia się TYLKO przy ręcznym transferze do innego działu (transfer_invoice_to_department)
  4. Trigger powinien tylko ustawiać `current_approver_id` (osobę która ma zaakceptować)

  ## Zmiany

  - Usuń ustawianie `uploaded_by` z triggera `auto_set_invoice_owner()`
  - Pozostaw tylko ustawianie `current_approver_id`
*/

-- Napraw trigger aby NIE zmieniał uploaded_by
CREATE OR REPLACE FUNCTION auto_set_invoice_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  -- Tylko jeśli zmienił się dział lub jeśli to nowa faktura z działem
  IF (TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id) 
     OR (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL) THEN
    
    -- Pobierz manager_id i director_id bezpośrednio z tabeli departments
    SELECT manager_id, director_id
    INTO v_manager_id, v_director_id
    FROM departments
    WHERE id = NEW.department_id;

    -- Ustaw current_approver_id (osobę która ma zaakceptować fakturę)
    -- Najpierw próbuj ustawić kierownika
    IF v_manager_id IS NOT NULL THEN
      NEW.current_approver_id := v_manager_id;
    -- Jeśli nie ma kierownika, ustaw dyrektora
    ELSIF v_director_id IS NOT NULL THEN
      NEW.current_approver_id := v_director_id;
    END IF;

    -- Jeśli zmienia się dział (transfer poprzez UPDATE), ustaw status na draft
    IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      NEW.status := 'draft';
    END IF;
  END IF;

  -- NIE zmieniaj uploaded_by - to pole jest ustawiane przez aplikację
  -- i zmienia się tylko przy ręcznym transferze (transfer_invoice_to_department)

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia current_approver_id na kierownika lub dyrektora działu.
NIE zmienia uploaded_by - właściciel faktury to zawsze osoba która dodała fakturę do systemu.
uploaded_by zmienia się tylko przy ręcznym transferze faktury (transfer_invoice_to_department).';
