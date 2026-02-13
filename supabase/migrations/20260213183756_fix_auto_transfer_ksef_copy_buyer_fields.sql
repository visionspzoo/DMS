/*
  # Naprawa auto-transferu KSEF - kopiowanie danych odbiorcy (nabywcy)

  1. Problem
    - Trigger `auto_transfer_ksef_to_invoices` nie kopiował pol `buyer_name` i `buyer_nip`
      z tabeli `ksef_invoices` do `invoices`
    - Faktury automatycznie przenoszone nie mialy danych odbiorcy

  2. Rozwiazanie
    - Aktualizuje funkcje `auto_transfer_ksef_to_invoices` aby kopiowala rowniez pola `buyer_name` i `buyer_nip`

  3. Zmiany
    - Dodaje `buyer_name` i `buyer_nip` do INSERT INTO invoices w funkcji triggera
    - Kopiuje wartosci z NEW.buyer_name i NEW.buyer_nip
*/

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
  IF NEW.transferred_to_department_id IS NOT NULL AND NEW.transferred_to_invoice_id IS NULL THEN
    
    SELECT assigned_user_id INTO v_assigned_user_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;
    
    IF v_assigned_user_id IS NOT NULL THEN
      v_current_approver_id := v_assigned_user_id;
    ELSE
      SELECT id INTO v_current_approver_id
      FROM profiles
      WHERE department_id = NEW.transferred_to_department_id
        AND role = 'Kierownik'
      LIMIT 1;
    END IF;
    
    v_tax_amount := NEW.tax_amount;
    IF v_tax_amount IS NULL THEN
      v_tax_amount := NEW.gross_amount - NEW.net_amount;
    END IF;
    
    INSERT INTO invoices (
      invoice_number,
      supplier_name,
      supplier_nip,
      buyer_name,
      buyer_nip,
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
      NEW.buyer_name,
      NEW.buyer_nip,
      NEW.gross_amount,
      NEW.net_amount,
      v_tax_amount,
      NEW.currency,
      NEW.issue_date,
      'draft',
      NEW.fetched_by,
      NEW.transferred_to_department_id,
      v_current_approver_id,
      'Faktura KSEF - automatycznie przypisana',
      'ksef',
      NEW.gross_amount,
      1.0,
      NEW.pdf_base64
    )
    RETURNING id INTO v_new_invoice_id;
    
    UPDATE ksef_invoices
    SET 
      transferred_to_invoice_id = v_new_invoice_id,
      transferred_at = NOW()
    WHERE id = NEW.id;
  END IF;
  
  RETURN NEW;
END;
$$;
