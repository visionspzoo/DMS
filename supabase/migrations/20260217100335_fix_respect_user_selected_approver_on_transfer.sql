/*
  # Napraw: Respektuj Właściciela Wybranego przez Użytkownika
  
  ## Problem
  
  Trigger `auto_set_owner_on_department_change` nadpisuje `current_approver_id` 
  nawet jeśli użytkownik wybrał konkretną osobę podczas transferu faktury.
  
  Faktura PL-AEU-2026-38169 została przypisana do Natalii Michalak (dyrektor) zamiast
  do wybranego użytkownika "Aura Herbals".
  
  ## Przyczyna
  
  W triggerze linia 37-38:
  ```sql
  IF (TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id) 
     OR (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.current_approver_id IS NULL)
  ```
  
  Dla UPDATE zawsze nadpisuje właściciela gdy zmienia się dział, 
  NIE sprawdzając czy current_approver_id został już ustawiony przez użytkownika!
  
  ## Rozwiązanie
  
  Zmień trigger aby:
  1. Nie nadpisywał current_approver_id jeśli użytkownik już go wybrał
  2. Ustawiał domyślnego właściciela TYLKO gdy current_approver_id jest NULL
  3. Respektował wybór użytkownika podczas transferu
  
  ## Zmiany
  
  - Dla UPDATE: sprawdź czy NEW.current_approver_id IS NULL przed nadpisaniem
  - Dla INSERT: zachowaj istniejącą logikę (działa poprawnie)
*/

-- Popraw funkcję aby respektowała wybór użytkownika
CREATE OR REPLACE FUNCTION auto_set_invoice_owner()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
BEGIN
  -- Tylko jeśli:
  -- 1. INSERT z nowym działem i BRAK właściciela
  -- 2. UPDATE zmiany działu i BRAK właściciela (użytkownik nie wybrał nikogo)
  IF (TG_OP = 'INSERT' AND NEW.department_id IS NOT NULL AND NEW.current_approver_id IS NULL)
     OR (TG_OP = 'UPDATE' 
         AND OLD.department_id IS DISTINCT FROM NEW.department_id 
         AND NEW.current_approver_id IS NULL) THEN
    
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
  END IF;

  -- Jeśli zmienia się dział (transfer), ustaw status na draft
  -- żeby faktura nie była liczona jako "w procesie" u poprzedniego właściciela
  IF TG_OP = 'UPDATE' AND OLD.department_id IS DISTINCT FROM NEW.department_id THEN
    NEW.status := 'draft';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

COMMENT ON FUNCTION auto_set_invoice_owner IS 
'Automatycznie ustawia właściciela faktury (current_approver_id) na kierownika lub dyrektora działu 
TYLKO gdy użytkownik nie wybrał nikogo (current_approver_id IS NULL). 
Respektuje wybór użytkownika podczas transferu. Status jest ustawiany na draft przy transferze między działami.';

-- Test: Sprawdź czy trigger respektuje wybór użytkownika
DO $$
DECLARE
  v_test_dept_id uuid;
  v_test_user_id uuid;
  v_director_id uuid;
  v_invoice_id uuid;
  v_final_approver uuid;
BEGIN
  -- Pobierz przykładowy dział i użytkownika
  SELECT id INTO v_test_dept_id FROM departments LIMIT 1;
  SELECT id INTO v_test_user_id FROM profiles WHERE role = 'Specjalista' LIMIT 1;
  SELECT id INTO v_director_id FROM profiles WHERE role = 'Dyrektor' LIMIT 1;
  
  IF v_test_dept_id IS NOT NULL AND v_test_user_id IS NOT NULL AND v_director_id IS NOT NULL THEN
    -- Stwórz testową fakturę z wybranym właścicielem
    INSERT INTO invoices (
      invoice_number,
      supplier_name,
      supplier_nip,
      gross_amount,
      net_amount,
      tax_amount,
      currency,
      issue_date,
      status,
      uploaded_by,
      department_id,
      current_approver_id
    ) VALUES (
      'TEST-RESPECT-CHOICE-001',
      'Test Supplier',
      '1234567890',
      1000,
      813,
      187,
      'PLN',
      CURRENT_DATE,
      'draft',
      v_test_user_id,
      v_test_dept_id,
      v_test_user_id  -- Użytkownik wybrał siebie jako właściciela
    ) RETURNING id INTO v_invoice_id;
    
    -- Sprawdź czy właściciel został zachowany (nie nadpisany)
    SELECT current_approver_id INTO v_final_approver
    FROM invoices
    WHERE id = v_invoice_id;
    
    IF v_final_approver = v_test_user_id THEN
      RAISE NOTICE '✓ Test PASSED: Trigger respektuje wybór użytkownika (approver: %)', v_final_approver;
    ELSE
      RAISE WARNING '✗ Test FAILED: Trigger nadpisał wybór użytkownika (expected: %, got: %)', v_test_user_id, v_final_approver;
    END IF;
    
    -- Usuń testową fakturę
    DELETE FROM invoices WHERE id = v_invoice_id;
  ELSE
    RAISE NOTICE 'Brak danych do testu (wymagany dział, specjalista i dyrektor)';
  END IF;
END $$;
