/*
  # Naprawa autoryzacji transferu dla Dyrektorów i Kierowników

  ## Zmiany
  1. Zaktualizuj funkcję transfer_invoice_to_department
  2. Dodaj sprawdzenie czy użytkownik jest dyrektorem działu faktury (director_id)
  3. Dodaj sprawdzenie czy Kierownik może transferować faktury Specjalistów ze swojego działu

  ## Uzasadnienie
  Dyrektorzy powinni móc transferować faktury z działów, których są dyrektorami,
  nie tylko z działu gdzie mają przypisane department_id.
  
  Kierownicy powinni móc transferować faktury Specjalistów ze swojego działu.
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
  v_user_name text;
  v_invoice record;
  v_old_dept_name text;
  v_new_dept_name text;
  v_new_approver_name text;
  v_new_approver_role text;
  v_authorized boolean := false;
  v_description text;
  v_invoice_dept_director_id uuid;
  v_uploader_role text;
BEGIN
  v_user_id := auth.uid();
  
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  -- Pobierz dane użytkownika wykonującego transfer
  SELECT role, department_id, is_admin, full_name
  INTO v_user_role, v_user_dept, v_user_is_admin, v_user_name
  FROM profiles
  WHERE id = v_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found';
  END IF;

  -- Pobierz dane faktury
  SELECT * INTO v_invoice
  FROM invoices
  WHERE id = p_invoice_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice not found';
  END IF;

  -- Sprawdź autoryzację
  IF v_user_is_admin = true OR v_user_role = 'CEO' THEN
    v_authorized := true;
  ELSIF v_invoice.uploaded_by = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.current_approver_id = v_user_id THEN
    v_authorized := true;
  ELSIF v_invoice.department_id = v_user_dept THEN
    v_authorized := true;
  ELSE
    -- Sprawdź czy użytkownik jest Dyrektorem działu faktury
    IF v_user_role = 'Dyrektor' AND v_invoice.department_id IS NOT NULL THEN
      SELECT director_id INTO v_invoice_dept_director_id
      FROM departments
      WHERE id = v_invoice.department_id;
      
      IF v_invoice_dept_director_id = v_user_id THEN
        v_authorized := true;
      END IF;
    END IF;
    
    -- Sprawdź czy Kierownik transferuje fakturę Specjalisty ze swojego działu
    IF NOT v_authorized AND v_user_role = 'Kierownik' AND v_invoice.department_id = v_user_dept THEN
      SELECT role INTO v_uploader_role
      FROM profiles
      WHERE id = v_invoice.uploaded_by;
      
      IF v_uploader_role = 'Specjalista' THEN
        v_authorized := true;
      END IF;
    END IF;
  END IF;

  IF NOT v_authorized THEN
    RAISE EXCEPTION 'Not authorized to transfer this invoice';
  END IF;

  -- Pobierz nazwy działów
  SELECT name INTO v_old_dept_name FROM departments WHERE id = v_invoice.department_id;
  SELECT name INTO v_new_dept_name FROM departments WHERE id = p_department_id;

  -- Pobierz dane nowego approvera
  SELECT full_name, role INTO v_new_approver_name, v_new_approver_role
  FROM profiles
  WHERE id = p_approver_id;

  -- Wykonaj transfer
  UPDATE invoices
  SET 
    department_id = p_department_id,
    current_approver_id = p_approver_id,
    status = 'draft',
    updated_at = now()
  WHERE id = p_invoice_id;

  -- Stwórz szczegółowy opis
  v_description := format(
    'Faktura przeniesiona z działu "%s" do "%s"',
    COALESCE(v_old_dept_name, 'nieznany'),
    COALESCE(v_new_dept_name, 'nieznany')
  );

  IF v_new_approver_name IS NOT NULL THEN
    v_description := v_description || format(
      ' i przypisana do: %s (%s)',
      v_new_approver_name,
      COALESCE(v_new_approver_role, 'brak roli')
    );
  END IF;

  IF v_user_name IS NOT NULL THEN
    v_description := v_description || format(' | Przeniósł: %s', v_user_name);
  END IF;

  -- Zaloguj transfer w historii zmian
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
      'status', v_invoice.status
    ),
    jsonb_build_object(
      'department_id', p_department_id,
      'department_name', v_new_dept_name,
      'current_approver_id', p_approver_id,
      'new_approver_name', v_new_approver_name,
      'new_approver_role', v_new_approver_role,
      'status', 'draft'
    ),
    v_description
  );

  RETURN jsonb_build_object('success', true, 'invoice_id', p_invoice_id);
END;
$$;
