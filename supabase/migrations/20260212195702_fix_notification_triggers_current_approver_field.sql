/*
  # Fix notification triggers - wrong column name

  1. Changes
    - Fix `notify_invoice_assigned` function: change `current_approver` to `current_approver_id`
    - Fix `notify_ksef_invoice_assigned` function: change `current_approver` to `current_approver_id`

  2. Reason
    - Both functions referenced `NEW.current_approver` which does not exist
    - The actual column name is `current_approver_id`
    - This caused "record new has no field current_approver" error on invoice insert/update
*/

CREATE OR REPLACE FUNCTION notify_invoice_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_uploader_name text;
  v_department_name text;
BEGIN
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id
     AND NEW.current_approver_id IS NOT NULL
     AND NEW.status NOT IN ('draft', 'waiting') THEN

    SELECT full_name INTO v_uploader_name
    FROM profiles
    WHERE id = NEW.uploaded_by;

    SELECT name INTO v_department_name
    FROM departments
    WHERE id = NEW.department_id;

    INSERT INTO notifications (user_id, type, title, message, invoice_id)
    VALUES (
      NEW.current_approver_id,
      'invoice_assigned',
      'Przypisano Ci fakturę do akceptacji',
      'Faktura ' || NEW.invoice_number ||
      CASE
        WHEN v_uploader_name IS NOT NULL THEN ' od ' || v_uploader_name
        ELSE ''
      END ||
      CASE
        WHEN v_department_name IS NOT NULL THEN ' (Dział: ' || v_department_name || ')'
        ELSE ''
      END || ' oczekuje na Twoją akceptację',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

CREATE OR REPLACE FUNCTION notify_ksef_invoice_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_department_name text;
BEGIN
  IF NEW.source = 'ksef'
     AND NEW.current_approver_id IS NOT NULL
     AND NEW.status NOT IN ('draft', 'waiting')
     AND NEW.created_at > (now() - interval '1 minute') THEN

    SELECT name INTO v_department_name
    FROM departments
    WHERE id = NEW.department_id;

    INSERT INTO notifications (user_id, type, title, message, invoice_id)
    VALUES (
      NEW.current_approver_id,
      'ksef_invoice_assigned',
      'Nowa faktura z KSeF przypisana',
      'Faktura ' || NEW.invoice_number || ' z systemu KSeF' ||
      CASE
        WHEN v_department_name IS NOT NULL THEN ' (Dział: ' || v_department_name || ')'
        ELSE ''
      END || ' została automatycznie przypisana do Ciebie',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;