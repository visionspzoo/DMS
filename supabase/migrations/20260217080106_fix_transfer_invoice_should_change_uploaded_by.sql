/*
  # Napraw funkcję transfer_invoice - powinna zmieniać uploaded_by

  ## Problem

  Funkcja `transfer_invoice_to_department` zmienia tylko:
  - `department_id` (nowy dział)
  - `current_approver_id` (nowy zatwierdzający)
  - `status` (draft)

  Ale NIE zmienia `uploaded_by` (właściciela faktury).

  To powoduje, że:
  1. Stary właściciel nadal widzi fakturę u siebie
  2. Nowy właściciel (kierownik nowego działu) nie jest "właścicielem" w systemie
  3. Faktura jest nieprawidłowo przypisana

  ## Rozwiązanie

  Zmień funkcję `transfer_invoice_to_department` aby również zmieniała `uploaded_by` na nowego zatwierdzającego.

  ## Zmiany

  - Dodaj `uploaded_by = p_approver_id` w UPDATE
  - Dodaj `uploaded_by` do audit log
*/

CREATE OR REPLACE FUNCTION transfer_invoice_to_department(
  p_invoice_id uuid,
  p_department_id uuid,
  p_approver_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id uuid;
  v_user_role text;
  v_user_dept uuid;
  v_user_is_admin boolean;
  v_invoice record;
  v_old_dept_name text;
  v_new_dept_name text;
  v_old_owner_name text;
  v_new_owner_name text;
  v_authorized boolean := false;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT role, department_id, is_admin
  INTO v_user_role, v_user_dept, v_user_is_admin
  FROM profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  IF v_user_is_admin = true OR v_user_role = 'CEO' THEN
    v_authorized := true;
  ELSIF v_invoice.uploaded_by = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.current_approver_id = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.department_id = v_user_dept THEN
    v_authorized := true;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to transfer this invoice';
  END IF;

  -- Pobierz nazwy działów i właścicieli
  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;
  SELECT full_name INTO v_old_owner_name FROM profiles WHERE id = v_invoice.uploaded_by;
  SELECT full_name INTO v_new_owner_name FROM profiles WHERE id = p_approver_id;

  -- Zaktualizuj fakturę - zmień właściciela, dział i zatwierdzającego
  UPDATE invoices
  SET 
    department_id = p_department_id,
    current_approver_id = p_approver_id,
    uploaded_by = p_approver_id,  -- ZMIEŃ WŁAŚCICIELA
    status = 'draft',
    updated_at = now()
  WHERE id = p_invoice_id;

  -- Zapisz w audit log transfer właściciela
  INSERT INTO audit_logs (
    invoice_id,
    user_id,
    action,
    old_values,
    new_values,
    description
  ) VALUES (
    p_invoice_id,
    v_user_id,
    'transferred_to_department',
    jsonb_build_object(
      'department_id', v_invoice.department_id,
      'department_name', v_old_dept_name,
      'current_approver_id', v_invoice.current_approver_id,
      'uploaded_by', v_invoice.uploaded_by,
      'owner_name', v_old_owner_name
    ),
    jsonb_build_object(
      'department_id', p_department_id,
      'department_name', v_new_dept_name,
      'current_approver_id', p_approver_id,
      'uploaded_by', p_approver_id,
      'owner_name', v_new_owner_name
    ),
    format('Faktura przekazana z działu %s (właściciel: %s) do %s (właściciel: %s)', 
      COALESCE(v_old_dept_name, 'nieznany'), 
      COALESCE(v_old_owner_name, 'nieznany'),
      COALESCE(v_new_dept_name, 'nieznany'),
      COALESCE(v_new_owner_name, 'nieznany'))
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;

COMMENT ON FUNCTION transfer_invoice_to_department IS 
'Przekazuje fakturę do innego działu i zmienia właściciela (uploaded_by) na nowego zatwierdzającego.
Funkcja używa SECURITY DEFINER aby ominąć RLS i wykonuje własne sprawdzenia autoryzacji.';
