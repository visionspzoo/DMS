/*
  # Add purchase_request_comment notification type and trigger

  ## Summary
  When a comment is added to a purchase request, all relevant participants
  are notified automatically via the app notification system and Slack.

  ## Changes
  1. Extends notifications type_check constraint with `purchase_request_comment`
  2. Adds `notify_purchase_request_comment()` trigger function on INSERT on
     `purchase_request_comments`:
     - Notifies the request submitter (unless they wrote the comment)
     - Notifies the current approver (unless they wrote the comment)
     - Notifies all admins (unless they wrote the comment)
     - All unique recipients get exactly one notification per comment

  ## Notes
  - The existing `slack_notification_trigger` on the notifications table
    automatically forwards every inserted notification to Slack, so no
    extra Slack wiring is needed here.
*/

-- 1. Extend the type constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'new_invoice'::text,
    'status_change'::text,
    'pending_review'::text,
    'invoice_assigned'::text,
    'invoice_transferred'::text,
    'ksef_invoice_assigned'::text,
    'new_contract'::text,
    'contract_status_change'::text,
    'duplicate_detected'::text,
    'invoice_draft_received'::text,
    'invoice_paid'::text,
    'purchase_request_assigned'::text,
    'purchase_request_approved'::text,
    'purchase_request_paid'::text,
    'purchase_request_rejected'::text,
    'purchase_request_comment'::text
  ]));

-- 2. Trigger function
CREATE OR REPLACE FUNCTION notify_purchase_request_comment()
RETURNS trigger AS $$
DECLARE
  v_request       purchase_requests%ROWTYPE;
  v_commenter     text;
  v_desc_short    text;
  v_comment_short text;
  v_title         text;
  v_message       text;
  v_admin_id      uuid;
  v_notified      uuid[];
BEGIN
  SELECT * INTO v_request FROM purchase_requests WHERE id = NEW.purchase_request_id;

  SELECT full_name INTO v_commenter FROM profiles WHERE id = NEW.user_id;

  v_desc_short    := COALESCE(LEFT(v_request.description, 50), 'brak opisu');
  v_comment_short := COALESCE(LEFT(NEW.content, 80), '');
  v_title         := 'Nowy komentarz do wniosku zakupowego';
  v_message       := COALESCE(v_commenter, 'Ktoś') ||
                     ' skomentował wniosek „' || v_desc_short || '": ' ||
                     v_comment_short;

  v_notified := ARRAY[]::uuid[];

  -- Notify request submitter (unless they are the commenter)
  IF v_request.user_id IS NOT NULL AND v_request.user_id <> NEW.user_id THEN
    INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
    VALUES (v_request.user_id, 'purchase_request_comment', v_title, v_message, NEW.purchase_request_id);
    v_notified := v_notified || v_request.user_id;
  END IF;

  -- Notify current approver (unless already notified or is the commenter)
  IF v_request.current_approver_id IS NOT NULL
     AND v_request.current_approver_id <> NEW.user_id
     AND NOT (v_request.current_approver_id = ANY(v_notified)) THEN
    INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
    VALUES (v_request.current_approver_id, 'purchase_request_comment', v_title, v_message, NEW.purchase_request_id);
    v_notified := v_notified || v_request.current_approver_id;
  END IF;

  -- Notify all admins (unless already notified or is the commenter)
  FOR v_admin_id IN
    SELECT id FROM profiles WHERE is_admin = true
  LOOP
    IF v_admin_id <> NEW.user_id AND NOT (v_admin_id = ANY(v_notified)) THEN
      INSERT INTO notifications (user_id, type, title, message, purchase_request_id)
      VALUES (v_admin_id, 'purchase_request_comment', v_title, v_message, NEW.purchase_request_id);
      v_notified := v_notified || v_admin_id;
    END IF;
  END LOOP;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- 3. Attach trigger to purchase_request_comments
DROP TRIGGER IF EXISTS purchase_request_comment_notification ON purchase_request_comments;
CREATE TRIGGER purchase_request_comment_notification
  AFTER INSERT ON purchase_request_comments
  FOR EACH ROW
  EXECUTE FUNCTION notify_purchase_request_comment();
