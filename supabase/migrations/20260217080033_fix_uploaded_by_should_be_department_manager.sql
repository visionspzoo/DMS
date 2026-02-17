/*
  # Napraw logikę uploaded_by - powinno być ustawiane na kierownika działu

  ## Problem

  Gdy dyrektor lub inna osoba tworzy fakturę dla działu:
  1. System ustawia `uploaded_by` na osobę, która dodała fakturę (np. dyrektor)
  2. Ale `uploaded_by` oznacza "właściciela faktury", który powinien być kierownikiem działu
  3. To powoduje, że dyrektor widzi faktury, które nie należą do niego

  ## Rozwiązanie

  1. Zmień trigger `auto_set_invoice_owner()` aby ustawiał również `uploaded_by` (nie tylko `current_approver_id`)
  2. Przy tworzeniu faktury:
     - Jeśli faktura ma `department_id`, ustaw `uploaded_by` na kierownika działu
     - Jeśli nie ma kierownika, ustaw na dyrektora działu
  3. Właściciel (`uploaded_by`) zmienia się TYLKO przy ręcznym przekazaniu faktury (transfer)

  ## Zmiany

  - Zmodyfikuj funkcję `auto_set_invoice_owner()` aby ustawiała zarówno `uploaded_by` jak i `current_approver_id`
  - Dodaj warunek aby NIE zmieniać `uploaded_by` przy UPDATE (tylko przy INSERT)
*/

-- Zmodyfikuj funkcję aby ustawiała uploaded_by przy INSERT
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

    -- Najpierw próbuj ustawić kierownika
    IF v_manager_id IS NOT NULL THEN
      NEW.current_approver_id := v_manager_id;
      
      -- Przy INSERT ustaw również uploaded_by na kierownika
      IF TG_OP = 'INSERT' THEN
        NEW.uploaded_by := v_manager_id;
      END IF;
      
    -- Jeśli nie ma kierownika, ustaw dyrektora
    ELSIF v_director_id IS NOT NULL THEN
      NEW.current_approver_id := v_director_id;
      
      -- Przy INSERT ustaw również uploaded_by na dyrektora
      IF TG_OP = 'INSERT' THEN
        NEW.uploaded_by := v_director_id;
      END IF;
    END IF;

    -- Jeśli zmienia się dział (transfer poprzez UPDATE), ustaw status na draft
    -- ale NIE zmieniaj uploaded_by - właściciel zmienia się tylko przy ręcznym transferze
    IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
      NEW.status := 'draft';
      -- uploaded_by pozostaje bez zmian - zmienia się tylko przy transfer_invoice()
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia właściciela faktury (uploaded_by i current_approver_id) na kierownika lub dyrektora działu:
- Przy INSERT: ustaw zarówno uploaded_by jak i current_approver_id
- Przy UPDATE department_id: ustaw tylko current_approver_id, NIE zmieniaj uploaded_by
- uploaded_by zmienia się tylko przy ręcznym transferze faktury (transfer_invoice)';
