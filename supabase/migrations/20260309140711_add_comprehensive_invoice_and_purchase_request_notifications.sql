/*
  # Comprehensive notifications for invoices and purchase requests

  ## Invoice notifications (expanded)
  1. Draft received - when invoice with status='draft' is assigned to a department user
     (current_approver_id set while status=draft → notify the assignee)
  2. Waiting / Pending - invoice arrives for approval (current_approver_id user notified)
  3. Rejected - uploader (uploaded_by) notified
  4. Paid - uploader (uploaded_by) notified
  5. Accepted - uploader (uploaded_by) notified

  ## Purchase request notifications (new)
  6. Assigned for approval - notify current_approver_id when PR is created or escalated
  7. Approved - notify request owner (user_id)
  8. Paid - notify request owner (user_id)
  9. Rejected - notify request owner (user_id)

  ## Changes
  - Replace notify_invoice_status_change() with extended version covering 'paid', 'draft'
  - Add notify_invoice_draft_received() trigger for draft invoices assigned to approver
  - Add notify_purchase_request_assigned() trigger (AFTER INSERT on purchase_requests)
  - Add notify_purchase_request_status_change() trigger (AFTER UPDATE on purchase_requests)
  - All notifications also fire Slack via the existing slack_notification_trigger
*/

-- -------------------------------------------------------
-- 1. Extend notify_invoice_status_change to cover paid, and use specific types
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_invoice_status_change()
RETURNS trigger AS $$
DECLARE
  v_notification_title text;
  v_notification_message text;
  v_recipient_id uuid;
  v_notif_type text;
  v_invoice_ref text;
BEGIN
  IF OLD.status IS DISTINCT FROM NEW.status THEN

    v_invoice_ref := COALESCE(NEW.invoice_number, '(bez numeru)');

    CASE NEW.status
    WHEN 'pending' THEN
      v_notif_type := 'pending_review';
      v_notification_title := 'Faktura oczekuje na akceptację';
      v_notification_message := 'Faktura ' || v_invoice_ref || ' wymaga Twojej akceptacji';
      SELECT manager_id INTO v_recipient_id FROM departments WHERE id = NEW.department_id;

    WHEN 'waiting' THEN
      v_notif_type := 'pending_review';
      v_notification_title := 'Faktura oczekuje na akceptację';
      v_notification_message := 'Faktura ' || v_invoice_ref || ' wymaga Twojej akceptacji';
      v_recipient_id := NEW.current_approver_id;

    WHEN 'accepted' THEN
      v_notif_type := 'status_change';
      v_notification_title := 'Faktura zaakceptowana';
      v_notification_message := 'Twoja faktura ' || v_invoice_ref || ' została zaakceptowana';
      v_recipient_id := NEW.uploaded_by;

    WHEN 'rejected' THEN
      v_notif_type := 'status_change';
      v_notification_title := 'Faktura odrzucona';
      v_notification_message := 'Twoja faktura ' || v_invoice_ref || ' została odrzucona';
      v_recipient_id := NEW.uploaded_by;

    WHEN 'paid' THEN
      v_notif_type := 'invoice_paid';
      v_notification_title := 'Faktura opłacona';
      v_notification_message := 'Faktura ' || v_invoice_ref || ' została oznaczona jako opłacona';
      v_recipient_id := NEW.uploaded_by;

    ELSE
      RETURN NEW;
    END CASE;

    IF v_recipient_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (v_recipient_id, v_notif_type, v_notification_title, v_notification_message, NEW.id);
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- -------------------------------------------------------
-- 2. Notify when a draft invoice is assigned to someone
--    (current_approver_id set while status = 'draft')
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_invoice_draft_received()
RETURNS trigger AS $$
DECLARE
  v_invoice_ref text;
  v_uploader_name text;
  v_department_name text;
BEGIN
  -- Fire when current_approver_id changes and status = 'draft'
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id
     AND NEW.current_approver_id IS NOT NULL
     AND NEW.status = 'draft' THEN

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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS invoice_draft_received_notification ON invoices;
CREATE TRIGGER invoice_draft_received_notification
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_invoice_draft_received();

-- -------------------------------------------------------
-- 3. Notify current_approver when a NEW invoice is inserted with status='draft'
--    and already has current_approver_id set (e.g. auto-assigned)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_new_invoice_draft_received()
RETURNS trigger AS $$
DECLARE
  v_invoice_ref text;
  v_uploader_name text;
  v_department_name text;
BEGIN
  IF NEW.status = 'draft' AND NEW.current_approver_id IS NOT NULL THEN
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

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS new_invoice_draft_received_notification ON invoices;
CREATE TRIGGER new_invoice_draft_received_notification
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_invoice_draft_received();

-- -------------------------------------------------------
-- 4. Purchase request: notify current_approver on INSERT (new request assigned)
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_purchase_request_assigned()
RETURNS trigger AS $$
DECLARE
  v_submitter_name text;
  v_dept_name text;
  v_amount_fmt text;
BEGIN
  IF NEW.current_approver_id IS NOT NULL THEN
    SELECT full_name INTO v_submitter_name FROM profiles WHERE id = NEW.user_id;
    SELECT name INTO v_dept_name FROM departments WHERE id = NEW.department_id;
    v_amount_fmt := COALESCE(to_char(NEW.gross_amount, 'FM999 999 990.00'), '0.00') || ' zł';

    INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
    VALUES (
      NEW.current_approver_id,
      'purchase_request_assigned',
      'Nowy wniosek zakupowy do zatwierdzenia',
      'Wniosek od ' || COALESCE(v_submitter_name, 'nieznany') ||
        CASE WHEN v_dept_name IS NOT NULL THEN ' (' || v_dept_name || ')' ELSE '' END ||
        ': ' || COALESCE(NEW.description, 'brak opisu') ||
        ' – ' || v_amount_fmt || ' wymaga Twojego zatwierdzenia',
      NEW.id
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS purchase_request_assigned_notification ON purchase_requests;
CREATE TRIGGER purchase_request_assigned_notification
  AFTER INSERT ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_purchase_request_assigned();

-- -------------------------------------------------------
-- 5. Purchase request: notify on status change OR approver escalation
-- -------------------------------------------------------
CREATE OR REPLACE FUNCTION notify_purchase_request_status_change()
RETURNS trigger AS $$
DECLARE
  v_submitter_name text;
  v_dept_name text;
  v_amount_fmt text;
  v_desc_short text;
BEGIN
  v_amount_fmt := COALESCE(to_char(NEW.gross_amount, 'FM999 999 990.00'), '0.00') || ' zł';
  v_desc_short := COALESCE(LEFT(NEW.description, 60), 'brak opisu');
  SELECT name INTO v_dept_name FROM departments WHERE id = NEW.department_id;
  SELECT full_name INTO v_submitter_name FROM profiles WHERE id = NEW.user_id;

  -- Approver escalation: current_approver_id changed (manager → director)
  IF OLD.current_approver_id IS DISTINCT FROM NEW.current_approver_id
     AND NEW.current_approver_id IS NOT NULL
     AND (OLD.status = NEW.status OR NEW.status NOT IN ('approved', 'rejected', 'paid')) THEN

    INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
    VALUES (
      NEW.current_approver_id,
      'purchase_request_assigned',
      'Wniosek zakupowy przekazany do zatwierdzenia',
      'Wniosek od ' || COALESCE(v_submitter_name, 'nieznany') ||
        CASE WHEN v_dept_name IS NOT NULL THEN ' (' || v_dept_name || ')' ELSE '' END ||
        ': ' || v_desc_short || ' – ' || v_amount_fmt || ' oczekuje na Twoją akceptację',
      NEW.id
    );

  END IF;

  -- Status change notifications to request owner
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    CASE NEW.status

    WHEN 'approved' THEN
      INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
      VALUES (
        NEW.user_id,
        'purchase_request_approved',
        'Wniosek zakupowy zaakceptowany',
        'Twój wniosek: ' || v_desc_short || ' – ' || v_amount_fmt || ' został zaakceptowany',
        NEW.id
      );

    WHEN 'rejected' THEN
      INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
      VALUES (
        NEW.user_id,
        'purchase_request_rejected',
        'Wniosek zakupowy odrzucony',
        'Twój wniosek: ' || v_desc_short || ' – ' || v_amount_fmt || ' został odrzucony' ||
          CASE WHEN NEW.approver_comment IS NOT NULL THEN ': ' || NEW.approver_comment ELSE '' END,
        NEW.id
      );

    WHEN 'paid' THEN
      INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
      VALUES (
        NEW.user_id,
        'purchase_request_paid',
        'Wniosek zakupowy opłacony',
        'Twój wniosek: ' || v_desc_short || ' – ' || v_amount_fmt || ' został oznaczony jako opłacony',
        NEW.id
      );

    ELSE
      NULL;
    END CASE;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS purchase_request_status_change_notification ON purchase_requests;
CREATE TRIGGER purchase_request_status_change_notification
  AFTER UPDATE ON purchase_requests
  FOR EACH ROW
  EXECUTE FUNCTION notify_purchase_request_status_change();

-- -------------------------------------------------------
-- 6. Allow service role to insert notifications for purchase requests
-- -------------------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE tablename = 'notifications' AND policyname = 'Service role can insert notifications'
  ) THEN
    EXECUTE $policy$
      CREATE POLICY "Service role can insert notifications"
        ON notifications FOR INSERT
        TO service_role
        WITH CHECK (true)
    $policy$;
  END IF;
END $$;
