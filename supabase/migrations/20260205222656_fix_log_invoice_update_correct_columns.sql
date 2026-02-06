/*
  # Fix log_invoice_update to use correct audit_logs columns

  ## Problem
  - Previous migration used entity_type and entity_id columns
  - Actual audit_logs table uses invoice_id column

  ## Changes
  - Update log_invoice_update to use invoice_id instead of entity_type/entity_id
*/

CREATE OR REPLACE FUNCTION log_invoice_update()
RETURNS TRIGGER AS $$
DECLARE
  v_action text;
  v_description text;
  v_old_values jsonb := '{}'::jsonb;
  v_new_values jsonb := '{}'::jsonb;
BEGIN
  v_action := NULL;
  v_description := NULL;
  
  -- Track status changes
  IF OLD.status IS DISTINCT FROM NEW.status THEN
    v_action := 'status_changed';
    v_description := 'Status zmieniony z "' || OLD.status || '" na "' || NEW.status || '"';
    v_old_values := v_old_values || jsonb_build_object('status', OLD.status);
    v_new_values := v_new_values || jsonb_build_object('status', NEW.status);
  END IF;
  
  -- Track amount changes
  IF OLD.gross_amount IS DISTINCT FROM NEW.gross_amount THEN
    IF v_action IS NULL THEN
      v_action := 'amount_changed';
      v_description := 'Kwota brutto zmieniona z ' || OLD.gross_amount || ' na ' || NEW.gross_amount;
    ELSE
      v_description := v_description || '; Kwota brutto zmieniona z ' || OLD.gross_amount || ' na ' || NEW.gross_amount;
    END IF;
    v_old_values := v_old_values || jsonb_build_object('gross_amount', OLD.gross_amount);
    v_new_values := v_new_values || jsonb_build_object('gross_amount', NEW.gross_amount);
  END IF;
  
  -- Track invoice number changes
  IF OLD.invoice_number IS DISTINCT FROM NEW.invoice_number THEN
    IF v_action IS NULL THEN
      v_action := 'invoice_number_changed';
      v_description := 'Numer faktury zmieniony z "' || COALESCE(OLD.invoice_number, 'brak') || '" na "' || COALESCE(NEW.invoice_number, 'brak') || '"';
    ELSE
      v_description := v_description || '; Numer faktury zmieniony z "' || COALESCE(OLD.invoice_number, 'brak') || '" na "' || COALESCE(NEW.invoice_number, 'brak') || '"';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('invoice_number', OLD.invoice_number);
    v_new_values := v_new_values || jsonb_build_object('invoice_number', NEW.invoice_number);
  END IF;
  
  -- Track description changes
  IF OLD.description IS DISTINCT FROM NEW.description THEN
    IF v_action IS NULL THEN
      v_action := 'description_changed';
      v_description := 'Opis zmieniony';
    ELSE
      v_description := v_description || '; Opis zmieniony';
    END IF;
    v_old_values := v_old_values || jsonb_build_object('description', OLD.description);
    v_new_values := v_new_values || jsonb_build_object('description', NEW.description);
  END IF;
  
  -- If any changes were tracked, log them
  IF v_action IS NOT NULL THEN
    INSERT INTO audit_logs (
      invoice_id,
      action,
      description,
      old_values,
      new_values,
      user_id
    ) VALUES (
      NEW.id,
      v_action,
      v_description,
      v_old_values,
      v_new_values,
      auth.uid()
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
