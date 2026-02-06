/*
  # Create Notifications System

  ## New Tables
  - `notifications`
    - `id` (uuid, primary key)
    - `user_id` (uuid, references profiles) - User who receives the notification
    - `type` (text) - Type: 'new_invoice', 'status_change', 'pending_review'
    - `title` (text) - Notification title
    - `message` (text) - Notification message
    - `invoice_id` (uuid, references invoices) - Related invoice
    - `is_read` (boolean) - Whether notification was read
    - `created_at` (timestamptz)

  ## Security
  - Enable RLS
  - Users can only see their own notifications
  - Users can mark their own notifications as read

  ## Triggers
  - Auto-generate notifications when invoice status changes
  - Auto-generate notifications for new invoices assigned to user
*/

-- Create notifications table
CREATE TABLE IF NOT EXISTS notifications (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('new_invoice', 'status_change', 'pending_review')),
  title text NOT NULL,
  message text NOT NULL,
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE,
  is_read boolean DEFAULT false,
  created_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;

-- RLS Policies
CREATE POLICY "Users can view own notifications"
  ON notifications
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can update own notifications"
  ON notifications
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Trigger function to create notifications on invoice status changes
CREATE OR REPLACE FUNCTION notify_invoice_status_change()
RETURNS TRIGGER AS $$
DECLARE
  v_notification_title text;
  v_notification_message text;
  v_recipient_id uuid;
BEGIN
  -- Only trigger on status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    
    -- Determine notification based on new status
    CASE NEW.status
      WHEN 'pending' THEN
        -- Notify manager/director when invoice needs review
        v_notification_title := 'Faktura oczekuje na akceptację';
        v_notification_message := 'Faktura ' || NEW.invoice_number || ' wymaga Twojej akceptacji';
        
        -- Get department manager
        SELECT manager_id INTO v_recipient_id
        FROM departments
        WHERE id = NEW.department_id;
        
      WHEN 'accepted' THEN
        -- Notify uploader when their invoice is accepted
        v_notification_title := 'Faktura zaakceptowana';
        v_notification_message := 'Twoja faktura ' || NEW.invoice_number || ' została zaakceptowana';
        v_recipient_id := NEW.uploaded_by;
        
      WHEN 'rejected' THEN
        -- Notify uploader when their invoice is rejected
        v_notification_title := 'Faktura odrzucona';
        v_notification_message := 'Twoja faktura ' || NEW.invoice_number || ' została odrzucona';
        v_recipient_id := NEW.uploaded_by;
        
      ELSE
        -- No notification for other statuses
        RETURN NEW;
    END CASE;
    
    -- Create notification if recipient exists
    IF v_recipient_id IS NOT NULL THEN
      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (v_recipient_id, 'status_change', v_notification_title, v_notification_message, NEW.id);
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger to invoices table
DROP TRIGGER IF EXISTS invoice_status_change_notification ON invoices;
CREATE TRIGGER invoice_status_change_notification
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_invoice_status_change();

-- Trigger function to notify about new invoices
CREATE OR REPLACE FUNCTION notify_new_invoice()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip draft invoices
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;
  
  -- Notify uploader about their new invoice
  INSERT INTO notifications (user_id, type, title, message, invoice_id)
  VALUES (
    NEW.uploaded_by,
    'new_invoice',
    'Nowa faktura dodana',
    'Faktura ' || NEW.invoice_number || ' została pomyślnie dodana do systemu',
    NEW.id
  );
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger for new invoices
DROP TRIGGER IF EXISTS new_invoice_notification ON invoices;
CREATE TRIGGER new_invoice_notification
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_new_invoice();

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_notifications_is_read ON notifications(is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_created_at ON notifications(created_at DESC);