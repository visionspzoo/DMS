/*
  # Naprawa Triggera KSEF - Dodanie Timestampu Przypisania
  
  ## Problem
  - Trigger auto_assign_ksef_department_by_nip() ustawia transferred_to_department_id
  - Ale nie ustawia assigned_to_department_at timestamp
  - W rezultacie automatyczne przypisane faktury nie mogą być przeniesione do systemu głównego
  
  ## Rozwiązanie
  - Zaktualizuj trigger, aby ustawiał assigned_to_department_at gdy przypisuje dział
  - Zaktualizuj istniejące faktury KSEF, które mają przypisany dział ale brak timestamp
  
  ## Przypadki użycia
  - Nowe faktury KSEF z zmapowanym NIP → automatycznie przypisane do działu z timestampem
  - Istniejące faktury KSEF z przypisanym działem → uzupełnij timestamp
*/

-- Zaktualizuj funkcję triggera, aby ustawiała timestamp
CREATE OR REPLACE FUNCTION auto_assign_ksef_department_by_nip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_department_id uuid;
BEGIN
  -- Only proceed if supplier_nip is provided and department is not already assigned
  IF NEW.supplier_nip IS NOT NULL AND NEW.transferred_to_department_id IS NULL THEN
    -- Look up department mapping for this NIP
    SELECT department_id INTO v_department_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;
    
    -- If mapping found, assign the department and set timestamp
    IF v_department_id IS NOT NULL THEN
      NEW.transferred_to_department_id := v_department_id;
      NEW.assigned_to_department_at := NOW();
      RAISE NOTICE 'KSEF Invoice % auto-assigned to department % based on NIP % at %',
        NEW.invoice_number, v_department_id, NEW.supplier_nip, NEW.assigned_to_department_at;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Zaktualizuj istniejące faktury KSEF, które mają przypisany dział ale brak timestamp
UPDATE ksef_invoices
SET assigned_to_department_at = COALESCE(assigned_to_department_at, created_at)
WHERE transferred_to_department_id IS NOT NULL
  AND transferred_to_invoice_id IS NULL
  AND assigned_to_department_at IS NULL;
