/*
  # Fix draft invoice notifications - skip directors and managers

  ## Problem
  Directors (Dyrektor) and managers (Kierownik) were receiving Slack notifications
  about draft invoices submitted by their subordinates, even when they were not
  personally assigned as the invoice owner.

  ## Fix
  Update notify_invoice_draft_received() and notify_new_invoice_draft_received()
  to only send the "draft received" notification when the current_approver_id is:
  - A Specjalista (specialist), OR
  - The same person as uploaded_by (the uploader is also the assigned owner)

  Directors and managers (Dyrektor, Kierownik, CEO) are only notified when they
  are explicitly the uploader/owner of the draft invoice.
*/

CREATE OR REPLACE FUNCTION notify_invoice_draft_received()
RETURNS trigger AS $$
DECLARE
  v_invoice_ref text;
  v_uploader_name text;
  v_department_name text;
  v_approver_role text;
BEGIN
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id
     AND NEW.current_approver_id IS NOT NULL
     AND NEW.status = 'draft' THEN

    SELECT role INTO v_approver_role FROM profiles WHERE id = NEW.current_approver_id;

    IF v_approver_role NOT IN ('Dyrektor', 'Kierownik', 'CEO')
       OR NEW.current_approver_id = NEW.uploaded_by THEN

      v_invoice_ref := COALESCE(NEW.invoice_number, '(bez numeru)');
      SELECT full_name INTO v_uploader_name FROM profiles WHERE id = NEW.uploaded_by;
      SELECT name INTO v_department_name FROM departments WHERE id = NEW.department_id;

      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (
        NEW.current_approver_id,
        'invoice_draft_received',
        'Otrzymałeś fakturę roboczą',
        'Faktura ' || v_invoice_ref ||
          CASE WHEN v_uploader_name IS NOT NULL THEN ' od ' || v_uploader_name ELSE '' END ||
          CASE WHEN v_department_name IS NOT NULL THEN ' (Dział: ' || v_department_name || ')' ELSE '' END ||
          ' trafiła do Ciebie jako robocza',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_new_invoice_draft_received()
RETURNS trigger AS $$
DECLARE
  v_invoice_ref text;
  v_uploader_name text;
  v_department_name text;
  v_approver_role text;
BEGIN
  IF NEW.status = 'draft' AND NEW.current_approver_id IS NOT NULL THEN

    SELECT role INTO v_approver_role FROM profiles WHERE id = NEW.current_approver_id;

    IF v_approver_role NOT IN ('Dyrektor', 'Kierownik', 'CEO')
       OR NEW.current_approver_id = NEW.uploaded_by THEN

      v_invoice_ref := COALESCE(NEW.invoice_number, '(bez numeru)');
      SELECT full_name INTO v_uploader_name FROM profiles WHERE id = NEW.uploaded_by;
      SELECT name INTO v_department_name FROM departments WHERE id = NEW.department_id;

      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (
        NEW.current_approver_id,
        'invoice_draft_received',
        'Otrzymałeś fakturę roboczą',
        'Faktura ' || v_invoice_ref ||
          CASE WHEN v_uploader_name IS NOT NULL THEN ' od ' || v_uploader_name ELSE '' END ||
          CASE WHEN v_department_name IS NOT NULL THEN ' (Dział: ' || v_department_name || ')' ELSE '' END ||
          ' trafiła do Ciebie jako robocza',
        NEW.id
      );
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
