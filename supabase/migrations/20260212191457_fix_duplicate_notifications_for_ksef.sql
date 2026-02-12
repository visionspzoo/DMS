/*
  # Fix Duplicate Notifications for KSeF Invoices

  ## Changes
  - Update notify_new_invoice() to skip KSeF invoices (handled by separate trigger)
  - This prevents duplicate notifications when KSeF invoice is transferred to system
  
  ## Notes
  - KSeF invoices are now handled exclusively by notify_ksef_invoice_assigned()
  - Regular invoices still get notifications from notify_new_invoice()
*/

-- Update notify_new_invoice to skip KSeF invoices
CREATE OR REPLACE FUNCTION notify_new_invoice()
RETURNS TRIGGER AS $$
BEGIN
  -- Skip draft invoices
  IF NEW.status = 'draft' THEN
    RETURN NEW;
  END IF;
  
  -- Skip KSeF invoices (they have separate notification in notify_ksef_invoice_assigned)
  IF NEW.source = 'ksef' THEN
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
