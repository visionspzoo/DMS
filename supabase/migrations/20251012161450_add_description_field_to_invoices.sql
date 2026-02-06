/*
  # Add Description Field to Invoices

  1. Changes
    - Add `description` column to `invoices` table
      - `description` (text) - Optional description/notes for the invoice
  
  2. Notes
    - This field allows users to add custom notes or descriptions to invoices
    - The field is optional and can be edited by authorized users
    - Changes to this field will be tracked in audit logs
*/

-- Add description column to invoices table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'description'
  ) THEN
    ALTER TABLE invoices ADD COLUMN description text;
  END IF;
END $$;

-- Update the audit log function to track description changes
CREATE OR REPLACE FUNCTION log_invoice_update()
RETURNS TRIGGER AS $$
DECLARE
  v_user_id uuid;
  v_description text;
  v_action text;
  v_old_values jsonb := '{}'::jsonb;
  v_new_values jsonb := '{}'::jsonb;
BEGIN
  -- Get current user
  v_user_id := auth.uid();
  
  -- Track status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_action := 'status_changed';
    v_old_values := v_old_values || jsonb_build_object('status', OLD.status);
    v_new_values := v_new_values || jsonb_build_object('status', NEW.status);
    
    CASE NEW.status
      WHEN 'pending' THEN v_description := 'Status zmieniony na: Oczekująca';
      WHEN 'in_review' THEN v_description := 'Status zmieniony na: W weryfikacji';
      WHEN 'approved' THEN v_description := 'Status zmieniony na: Zatwierdzona';
      WHEN 'accepted' THEN v_description := 'Status zmieniony na: Zaakceptowana';
      WHEN 'rejected' THEN v_description := 'Status zmieniony na: Odrzucona';
      ELSE v_description := 'Status zmieniony na: ' || NEW.status;
    END CASE;
  END IF;
  
  -- Track department changes
  IF OLD.department IS DISTINCT FROM NEW.department THEN
    IF v_action IS NULL THEN
      v_action := 'department_changed';
      v_description := 'Dział zmieniony z "' || COALESCE(OLD.department, 'brak') || '" na "' || COALESCE(NEW.department, 'brak') || '"';
    ELSE
      v_description := v_description || '; Dział zmieniony z "' || COALESCE(OLD.department, 'brak') || '" na "' || COALESCE(NEW.department, 'brak') || '"';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('department', OLD.department);
    v_new_values := v_new_values || jsonb_build_object('department', NEW.department);
  END IF;
  
  -- Track invoice number changes
  IF OLD.invoice_number IS DISTINCT FROM NEW.invoice_number THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Numer faktury zaktualizowany';
    ELSE
      v_description := v_description || '; Numer faktury zaktualizowany';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('invoice_number', OLD.invoice_number);
    v_new_values := v_new_values || jsonb_build_object('invoice_number', NEW.invoice_number);
  END IF;
  
  -- Track amount changes
  IF OLD.gross_amount IS DISTINCT FROM NEW.gross_amount OR 
     OLD.net_amount IS DISTINCT FROM NEW.net_amount OR 
     OLD.tax_amount IS DISTINCT FROM NEW.tax_amount THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Kwoty faktury zaktualizowane';
    ELSE
      v_description := v_description || '; Kwoty faktury zaktualizowane';
    END IF;
    v_old_values := v_old_values || jsonb_build_object(
      'gross_amount', OLD.gross_amount,
      'net_amount', OLD.net_amount,
      'tax_amount', OLD.tax_amount
    );
    v_new_values := v_new_values || jsonb_build_object(
      'gross_amount', NEW.gross_amount,
      'net_amount', NEW.net_amount,
      'tax_amount', NEW.tax_amount
    );
  END IF;
  
  -- Track vendor changes
  IF OLD.supplier_name IS DISTINCT FROM NEW.supplier_name THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Nazwa dostawcy zaktualizowana';
    ELSE
      v_description := v_description || '; Nazwa dostawcy zaktualizowana';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('supplier_name', OLD.supplier_name);
    v_new_values := v_new_values || jsonb_build_object('supplier_name', NEW.supplier_name);
  END IF;
  
  -- Track date changes
  IF OLD.issue_date IS DISTINCT FROM NEW.issue_date THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Data faktury zaktualizowana';
    ELSE
      v_description := v_description || '; Data faktury zaktualizowana';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('issue_date', OLD.issue_date);
    v_new_values := v_new_values || jsonb_build_object('issue_date', NEW.issue_date);
  END IF;
  
  -- Track description changes
  IF OLD.description IS DISTINCT FROM NEW.description THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Opis faktury zaktualizowany';
    ELSE
      v_description := v_description || '; Opis faktury zaktualizowany';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('description', OLD.description);
    v_new_values := v_new_values || jsonb_build_object('description', NEW.description);
  END IF;
  
  -- Only log if there were actual changes
  IF v_action IS NOT NULL THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
    VALUES (NEW.id, v_user_id, v_action, v_old_values, v_new_values, v_description);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;