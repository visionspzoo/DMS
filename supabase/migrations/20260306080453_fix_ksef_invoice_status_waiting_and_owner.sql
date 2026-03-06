/*
  # Fix KSEF invoice status and owner on auto-transfer

  ## Problem 1 - Wrong status
  KSEF invoices transferred via the auto_transfer_ksef_to_invoices() trigger
  were created with status='draft', which required an extra manual confirmation
  step. This was not the original behavior - KSEF invoices should appear
  immediately in the workflow as 'waiting' (pending approval).

  ## Problem 2 - Wrong uploaded_by
  When a KSEF invoice was transferred to a department, the uploaded_by was
  set to the KSEF fetcher (e.g. an admin like s.hoffman@auraherbals.pl) instead
  of the department's manager or director. This caused the invoice to appear
  in the wrong person's inbox.

  ## Fix
  1. Change status from 'draft' to 'waiting' in auto_transfer_ksef_to_invoices()
  2. Set uploaded_by to department manager first, then director, not fetched_by
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
  v_dept_manager_id uuid;
  v_dept_director_id uuid;
  v_invoice_owner uuid;
BEGIN
  IF NEW.transferred_to_department_id IS NOT NULL AND NEW.transferred_to_invoice_id IS NULL THEN

    -- Get department manager and director
    SELECT d.manager_id, d.director_id
    INTO v_dept_manager_id, v_dept_director_id
    FROM departments d
    WHERE d.id = NEW.transferred_to_department_id;

    -- Get assigned_user_id from NIP mapping
    SELECT assigned_user_id INTO v_assigned_user_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;

    -- Determine approver:
    -- 1. Specific assigned user from NIP mapping
    -- 2. Department manager
    -- 3. Department director
    IF v_assigned_user_id IS NOT NULL THEN
      v_current_approver_id := v_assigned_user_id;
    ELSIF v_dept_manager_id IS NOT NULL THEN
      v_current_approver_id := v_dept_manager_id;
    ELSE
      v_current_approver_id := v_dept_director_id;
    END IF;

    -- Invoice owner (uploaded_by) = dept manager or director, NOT the KSEF fetcher
    v_invoice_owner := COALESCE(v_dept_manager_id, v_dept_director_id, NEW.fetched_by);

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
      exchange_rate
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
      'waiting',
      v_invoice_owner,
      NEW.transferred_to_department_id,
      v_current_approver_id,
      'Faktura z KSEF',
      'ksef',
      NEW.gross_amount,
      1.0
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

DROP TRIGGER IF EXISTS trigger_auto_transfer_ksef_to_invoices ON ksef_invoices;

CREATE TRIGGER trigger_auto_transfer_ksef_to_invoices
  AFTER INSERT ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_transfer_ksef_to_invoices();
