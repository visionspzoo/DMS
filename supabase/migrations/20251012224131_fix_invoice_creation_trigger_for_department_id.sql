/*
  # Naprawa triggera log_invoice_creation dla department_id

  1. Problem
    - Trigger log_invoice_creation używał starego pola 'department' zamiast 'department_id'
    - Powodowało to błąd przy tworzeniu nowej faktury
  
  2. Rozwiązanie
    - Podmiana NEW.department na NEW.department_id w funkcji
*/

-- Usuń stary trigger
DROP TRIGGER IF EXISTS trigger_log_invoice_creation ON invoices;

-- Utwórz zaktualizowaną funkcję
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
      'department_id', NEW.department_id,
      'invoice_number', NEW.invoice_number,
      'gross_amount', NEW.gross_amount
    ),
    'Faktura została dodana do systemu'
  );
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Utwórz nowy trigger
CREATE TRIGGER trigger_log_invoice_creation
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION log_invoice_creation();
