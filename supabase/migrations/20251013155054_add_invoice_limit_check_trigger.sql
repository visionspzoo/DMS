/*
  # Add Invoice Limit Check Trigger

  ## Overview
  This migration adds automatic limit checking for invoices. When an invoice is approved
  by a manager, the system checks if it exceeds the department's single invoice limit.
  If it does, the invoice is automatically forwarded to the parent department for
  director approval instead of being marked as accepted.

  ## Changes
  
  1. **New Function: `check_invoice_limits_and_forward()`**
     - Triggers when invoice status changes to 'accepted'
     - Checks if gross_amount > department's max_invoice_amount
     - If exceeded:
       - Changes status back to 'waiting'
       - Updates department_id to parent_department_id
       - Creates audit log entry
     - If within limit or no parent department exists:
       - Allows the acceptance to proceed

  2. **New Trigger: `invoice_limit_check_trigger`**
     - Fires BEFORE UPDATE on invoices table
     - Only when status changes to 'accepted'
     - Executes the limit checking function

  ## Logic Flow
  
  - Specjalista uploads invoice to IT department (limit: 1000 PLN)
  - Kierownik IT approves invoice worth 7500 PLN
  - Trigger detects: 7500 > 1000
  - Action: 
    - Status remains 'waiting' (not 'accepted')
    - department_id changes from IT to Marketing (parent)
    - Audit log created: "Przekazano do działu nadrzędnego - kwota przekracza limit"
  - Dyrektor Marketing must now approve the invoice
  
  ## Important Notes
  - If department has no max_invoice_amount set, no limit check is performed
  - If department has no parent, invoice proceeds to acceptance
  - Monthly limits are NOT checked by this trigger (future enhancement)
*/

-- Create function to check invoice limits and forward to parent department
CREATE OR REPLACE FUNCTION check_invoice_limits_and_forward()
RETURNS TRIGGER AS $$
DECLARE
  dept_limit DECIMAL(15,2);
  parent_dept_id UUID;
  dept_name TEXT;
  parent_dept_name TEXT;
BEGIN
  -- Only check if status is being changed to 'accepted'
  IF NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM 'accepted') THEN
    -- Get department limit and parent department
    SELECT 
      d.max_invoice_amount,
      d.parent_department_id,
      d.name,
      pd.name
    INTO 
      dept_limit,
      parent_dept_id,
      dept_name,
      parent_dept_name
    FROM departments d
    LEFT JOIN departments pd ON d.parent_department_id = pd.id
    WHERE d.id = NEW.department_id;

    -- If department has a limit set and invoice exceeds it
    IF dept_limit IS NOT NULL AND NEW.gross_amount > dept_limit THEN
      -- If there's a parent department, forward to it
      IF parent_dept_id IS NOT NULL THEN
        -- Change status back to waiting and update department
        NEW.status := 'waiting';
        NEW.department_id := parent_dept_id;
        
        -- Create audit log entry
        INSERT INTO audit_logs (
          invoice_id,
          user_id,
          action,
          old_values,
          new_values,
          description
        ) VALUES (
          NEW.id,
          auth.uid(),
          'forwarded_to_parent',
          jsonb_build_object(
            'department_id', OLD.department_id,
            'department_name', dept_name,
            'status', OLD.status
          ),
          jsonb_build_object(
            'department_id', NEW.department_id,
            'department_name', parent_dept_name,
            'status', NEW.status,
            'reason', 'Kwota faktury (' || NEW.gross_amount || ' ' || NEW.currency || ') przekracza limit działu (' || dept_limit || ' ' || NEW.currency || ')'
          ),
          'Automatycznie przekazano do działu nadrzędnego - kwota przekracza limit działu'
        );

        RAISE NOTICE 'Invoice % forwarded to parent department % (amount % exceeds limit %)',
          NEW.invoice_number, parent_dept_name, NEW.gross_amount, dept_limit;
      ELSE
        -- No parent department exists, allow acceptance
        RAISE NOTICE 'Invoice % exceeds limit but no parent department exists, accepting',
          NEW.invoice_number;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
DROP TRIGGER IF EXISTS invoice_limit_check_trigger ON invoices;
CREATE TRIGGER invoice_limit_check_trigger
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION check_invoice_limits_and_forward();
