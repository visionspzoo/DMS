/*
  # Add Audit Logs for Invoice History Tracking

  1. New Tables
    - `audit_logs`
      - `id` (uuid, primary key) - Unique identifier for each log entry
      - `invoice_id` (uuid, foreign key) - Reference to the invoice
      - `user_id` (uuid, foreign key) - User who made the change
      - `action` (text) - Type of action (created, updated, status_changed, department_changed, etc.)
      - `old_values` (jsonb) - Previous values before the change
      - `new_values` (jsonb) - New values after the change
      - `description` (text) - Human-readable description of the change
      - `created_at` (timestamptz) - When the change occurred

  2. Security
    - Enable RLS on `audit_logs` table
    - Add policies for authenticated users to read audit logs
    - Audit logs are read-only for users (only triggers can insert)

  3. Triggers
    - Automatically log invoice creation
    - Automatically log invoice updates (status, department, fields)
    - Track user information for each change

  4. Notes
    - Audit logs provide complete transparency of invoice lifecycle
    - All changes are immutable once logged
    - Users can view full history but cannot modify logs
*/

-- Create audit_logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid REFERENCES invoices(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  action text NOT NULL,
  old_values jsonb DEFAULT '{}'::jsonb,
  new_values jsonb DEFAULT '{}'::jsonb,
  description text NOT NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_audit_logs_invoice_id ON audit_logs(invoice_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_at ON audit_logs(created_at DESC);

-- Enable RLS
ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can read all audit logs
CREATE POLICY "Authenticated users can view audit logs"
  ON audit_logs
  FOR SELECT
  TO authenticated
  USING (true);

-- Function to log invoice creation
CREATE OR REPLACE FUNCTION log_invoice_creation()
RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO audit_logs (invoice_id, user_id, action, new_values, description)
  VALUES (
    NEW.id,
    NEW.uploaded_by,
    'created',
    jsonb_build_object(
      'status', NEW.status,
      'department', NEW.department,
      'invoice_number', NEW.invoice_number,
      'gross_amount', NEW.gross_amount
    ),
    'Faktura została dodana do systemu'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Function to log invoice updates
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
     OLD.vat_amount IS DISTINCT FROM NEW.vat_amount THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Kwoty faktury zaktualizowane';
    ELSE
      v_description := v_description || '; Kwoty faktury zaktualizowane';
    END IF;
    v_old_values := v_old_values || jsonb_build_object(
      'gross_amount', OLD.gross_amount,
      'net_amount', OLD.net_amount,
      'vat_amount', OLD.vat_amount
    );
    v_new_values := v_new_values || jsonb_build_object(
      'gross_amount', NEW.gross_amount,
      'net_amount', NEW.net_amount,
      'vat_amount', NEW.vat_amount
    );
  END IF;
  
  -- Track vendor changes
  IF OLD.vendor_name IS DISTINCT FROM NEW.vendor_name THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Nazwa dostawcy zaktualizowana';
    ELSE
      v_description := v_description || '; Nazwa dostawcy zaktualizowana';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('vendor_name', OLD.vendor_name);
    v_new_values := v_new_values || jsonb_build_object('vendor_name', NEW.vendor_name);
  END IF;
  
  -- Track date changes
  IF OLD.invoice_date IS DISTINCT FROM NEW.invoice_date THEN
    IF v_action IS NULL THEN
      v_action := 'field_updated';
      v_description := 'Data faktury zaktualizowana';
    ELSE
      v_description := v_description || '; Data faktury zaktualizowana';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('invoice_date', OLD.invoice_date);
    v_new_values := v_new_values || jsonb_build_object('invoice_date', NEW.invoice_date);
  END IF;
  
  -- Only log if there were actual changes
  IF v_action IS NOT NULL THEN
    INSERT INTO audit_logs (invoice_id, user_id, action, old_values, new_values, description)
    VALUES (NEW.id, v_user_id, v_action, v_old_values, v_new_values, v_description);
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create triggers
DROP TRIGGER IF EXISTS trigger_log_invoice_creation ON invoices;
CREATE TRIGGER trigger_log_invoice_creation
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION log_invoice_creation();

DROP TRIGGER IF EXISTS trigger_log_invoice_update ON invoices;
CREATE TRIGGER trigger_log_invoice_update
  AFTER UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION log_invoice_update();