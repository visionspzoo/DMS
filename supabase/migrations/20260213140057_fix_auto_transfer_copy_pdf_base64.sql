/*
  # Naprawa auto-transferu KSEF - kopiowanie PDF Base64

  ## Problem
  Trigger `auto_transfer_ksef_to_invoices` nie kopiował pola `pdf_base64` 
  z tabeli `ksef_invoices` do `invoices`, przez co faktury automatycznie 
  przypisywane nie miały PDF i nie mogły być uploadowane do Google Drive.

  ## Rozwiązanie
  Aktualizuje funkcję `auto_transfer_ksef_to_invoices` aby kopiowała również pole `pdf_base64`.

  ## Zmiany
  - Dodaje `pdf_base64` do INSERT INTO invoices w funkcji triggera
  - Kopiuje wartość z NEW.pdf_base64
*/

-- Funkcja do automatycznego transferu faktury KSEF do tabeli invoices (z pdf_base64)
CREATE OR REPLACE FUNCTION auto_transfer_ksef_to_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_assigned_user_id uuid;
  v_current_approver_id uuid;
  v_new_invoice_id uuid;
  v_tax_amount numeric;
BEGIN
  -- Tylko dla faktur, które mają przypisany dział i nie zostały jeszcze przeniesione
  IF NEW.transferred_to_department_id IS NOT NULL AND NEW.transferred_to_invoice_id IS NULL THEN
    
    -- Pobierz assigned_user_id z mapowania NIP
    SELECT assigned_user_id INTO v_assigned_user_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;
    
    -- Jeśli mamy przypisanego użytkownika, użyj go jako akceptanta
    IF v_assigned_user_id IS NOT NULL THEN
      v_current_approver_id := v_assigned_user_id;
      RAISE NOTICE 'KSEF Invoice % - using assigned user % as approver', 
        NEW.invoice_number, v_assigned_user_id;
    ELSE
      -- Jeśli nie ma przypisanego użytkownika, znajdź kierownika działu
      SELECT id INTO v_current_approver_id
      FROM profiles
      WHERE department_id = NEW.transferred_to_department_id
        AND role = 'Kierownik'
      LIMIT 1;
      
      RAISE NOTICE 'KSEF Invoice % - using department manager % as approver', 
        NEW.invoice_number, v_current_approver_id;
    END IF;
    
    -- Oblicz kwotę VAT
    v_tax_amount := NEW.tax_amount;
    IF v_tax_amount IS NULL THEN
      v_tax_amount := NEW.gross_amount - NEW.net_amount;
    END IF;
    
    -- Wstaw fakturę do tabeli invoices jako draft (z pdf_base64)
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
      current_approver_id,
      description,
      source,
      pln_gross_amount,
      exchange_rate,
      pdf_base64
    ) VALUES (
      NEW.invoice_number,
      NEW.supplier_name,
      NEW.supplier_nip,
      NEW.gross_amount,
      NEW.net_amount,
      v_tax_amount,
      NEW.currency,
      NEW.issue_date,
      'draft', -- Draft status - wymaga ręcznej akceptacji
      NEW.fetched_by,
      NEW.transferred_to_department_id,
      v_current_approver_id,
      'Faktura KSEF - automatycznie przypisana',
      'ksef',
      NEW.gross_amount, -- Zakładamy PLN, wymiana walut będzie przy submit
      1.0,
      NEW.pdf_base64 -- Kopiuj PDF Base64
    )
    RETURNING id INTO v_new_invoice_id;
    
    -- Aktualizuj rekord KSEF z ID przeniesionej faktury
    UPDATE ksef_invoices
    SET 
      transferred_to_invoice_id = v_new_invoice_id,
      transferred_at = NOW()
    WHERE id = NEW.id;
    
    RAISE NOTICE 'KSEF Invoice % auto-transferred to invoices table with ID % and approver % (with PDF)',
      NEW.invoice_number, v_new_invoice_id, v_current_approver_id;
  END IF;
  
  RETURN NEW;
END;
$$;
