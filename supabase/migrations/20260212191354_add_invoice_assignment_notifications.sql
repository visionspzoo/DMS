/*
  # Add Invoice Assignment Notifications

  ## Changes
  1. Extend notification types to include:
     - 'invoice_assigned' - When invoice is assigned to user (becomes current_approver)
     - 'invoice_transferred' - When someone transfers invoice to user
     - 'ksef_invoice_assigned' - When KSeF invoice is auto-assigned to user
  
  2. New Triggers:
     - Notify user when they become current_approver on an invoice
     - Notify user when invoice is transferred to them
  
  ## Security
  - Uses existing RLS policies for notifications table
*/

-- Update notification type constraint to include new types
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;
ALTER TABLE notifications ADD CONSTRAINT notifications_type_check 
  CHECK (type IN (
    'new_invoice', 
    'status_change', 
    'pending_review', 
    'invoice_assigned',
    'invoice_transferred',
    'ksef_invoice_assigned',
    'new_contract',
    'contract_status_change'
  ));

-- Function to notify user when invoice is assigned to them
CREATE OR REPLACE FUNCTION notify_invoice_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_uploader_name text;
  v_department_name text;
BEGIN
  -- Check if current_approver changed and is not null
  IF OLD.current_approver IS DISTINCT FROM NEW.current_approver 
     AND NEW.current_approver IS NOT NULL 
     AND NEW.status NOT IN ('draft', 'waiting') THEN
    
    -- Get uploader name
    SELECT full_name INTO v_uploader_name
    FROM profiles
    WHERE id = NEW.uploaded_by;
    
    -- Get department name
    SELECT name INTO v_department_name
    FROM departments
    WHERE id = NEW.department_id;
    
    -- Create notification for new approver
    INSERT INTO notifications (user_id, type, title, message, invoice_id)
    VALUES (
      NEW.current_approver,
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

-- Attach trigger for invoice assignment
DROP TRIGGER IF EXISTS invoice_assigned_notification ON invoices;
CREATE TRIGGER invoice_assigned_notification
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_invoice_assigned();

-- Function to notify user when invoice is transferred to their department
CREATE OR REPLACE FUNCTION notify_invoice_transferred()
RETURNS TRIGGER AS $$
DECLARE
  v_transferrer_name text;
  v_old_department_name text;
  v_new_department_name text;
  v_new_approver_id uuid;
BEGIN
  -- Check if department changed (invoice transferred)
  IF OLD.department_id IS DISTINCT FROM NEW.department_id 
     AND NEW.department_id IS NOT NULL 
     AND NEW.status NOT IN ('draft', 'waiting') THEN
    
    -- Get transferrer name (person who modified the invoice)
    SELECT full_name INTO v_transferrer_name
    FROM profiles
    WHERE id = auth.uid();
    
    -- Get old department name
    SELECT name INTO v_old_department_name
    FROM departments
    WHERE id = OLD.department_id;
    
    -- Get new department name and manager
    SELECT name, manager_id INTO v_new_department_name, v_new_approver_id
    FROM departments
    WHERE id = NEW.department_id;
    
    -- If there's a new approver (department manager), notify them
    IF v_new_approver_id IS NOT NULL AND v_new_approver_id <> auth.uid() THEN
      INSERT INTO notifications (user_id, type, title, message, invoice_id)
      VALUES (
        v_new_approver_id,
        'invoice_transferred',
        'Przekazano Ci fakturę',
        'Faktura ' || NEW.invoice_number || 
        CASE 
          WHEN v_transferrer_name IS NOT NULL THEN ' została przekazana przez ' || v_transferrer_name
          ELSE ' została przekazana'
        END ||
        CASE 
          WHEN v_old_department_name IS NOT NULL THEN ' z działu ' || v_old_department_name
          ELSE ''
        END || ' do działu ' || v_new_department_name,
        NEW.id
      );
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Attach trigger for invoice transfer
DROP TRIGGER IF EXISTS invoice_transferred_notification ON invoices;
CREATE TRIGGER invoice_transferred_notification
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_invoice_transferred();

-- Function to notify user when KSeF invoice is auto-assigned to them
CREATE OR REPLACE FUNCTION notify_ksef_invoice_assigned()
RETURNS TRIGGER AS $$
DECLARE
  v_department_name text;
BEGIN
  -- Check if invoice was transferred (moved from ksef_invoices to invoices)
  IF NEW.source = 'ksef' 
     AND NEW.current_approver IS NOT NULL 
     AND NEW.status NOT IN ('draft', 'waiting')
     AND NEW.created_at > (now() - interval '1 minute') THEN
    
    -- Get department name
    SELECT name INTO v_department_name
    FROM departments
    WHERE id = NEW.department_id;
    
    -- Create notification for approver
    INSERT INTO notifications (user_id, type, title, message, invoice_id)
    VALUES (
      NEW.current_approver,
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

-- Attach trigger for KSeF invoice assignment (on INSERT only)
DROP TRIGGER IF EXISTS ksef_invoice_assigned_notification ON invoices;
CREATE TRIGGER ksef_invoice_assigned_notification
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION notify_ksef_invoice_assigned();
