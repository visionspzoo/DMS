/*
  # Fix Monthly Limit Check Trigger

  ## Overview
  This migration replaces the single invoice limit check with a monthly total limit check.
  The system now checks if the TOTAL of all invoices in the current month (including the
  new one) exceeds the department's monthly limit.

  ## Changes
  
  1. **Updated Function: `check_invoice_limits_and_forward()`**
     - Removes single invoice limit check
     - Adds monthly total calculation
     - Checks if (current_month_total + new_invoice) > max_monthly_amount
     - If exceeded:
       - Changes status back to 'waiting'
       - Updates department_id to parent_department_id
       - Creates audit log entry with monthly total details
     - If within limit or no parent department exists:
       - Allows the acceptance to proceed

  ## Logic Flow
  
  Example with IT department (monthly limit: 10,000 PLN):
  - Month so far: 6,000 PLN in accepted invoices
  - New invoice: 5,000 PLN
  - Total would be: 11,000 PLN
  - Trigger detects: 11,000 > 10,000
  - Action:
    - Status remains 'waiting' (not 'accepted')
    - department_id changes to parent department
    - Audit log: "Suma miesięczna (11000 PLN) przekracza limit (10000 PLN)"
  
  ## Important Notes
  - Only counts invoices with status 'accepted' or 'paid' for monthly calculation
  - If department has no max_monthly_amount set, no limit check is performed
  - If department has no parent, invoice proceeds despite exceeding limit
  - Monthly calculation is based on created_at timestamp
*/

-- Drop old trigger
DROP TRIGGER IF EXISTS invoice_limit_check_trigger ON invoices;

-- Replace function to check monthly limits
CREATE OR REPLACE FUNCTION check_invoice_limits_and_forward()
RETURNS TRIGGER AS $$
DECLARE
  monthly_limit DECIMAL(15,2);
  current_month_total DECIMAL(15,2);
  new_month_total DECIMAL(15,2);
  parent_dept_id UUID;
  dept_name TEXT;
  parent_dept_name TEXT;
BEGIN
  -- Only check if status is being changed to 'accepted'
  IF NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM 'accepted') THEN
    -- Get department monthly limit and parent department
    SELECT 
      d.max_monthly_amount,
      d.parent_department_id,
      d.name,
      pd.name
    INTO 
      monthly_limit,
      parent_dept_id,
      dept_name,
      parent_dept_name
    FROM departments d
    LEFT JOIN departments pd ON d.parent_department_id = pd.id
    WHERE d.id = NEW.department_id;

    -- If department has a monthly limit set
    IF monthly_limit IS NOT NULL THEN
      -- Calculate current month total (excluding this invoice)
      SELECT COALESCE(SUM(gross_amount), 0)
      INTO current_month_total
      FROM invoices
      WHERE department_id = NEW.department_id
        AND id != NEW.id
        AND status IN ('accepted', 'paid')
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NEW.created_at);

      -- Calculate what the new total would be
      new_month_total := current_month_total + NEW.gross_amount;

      -- If new total exceeds monthly limit
      IF new_month_total > monthly_limit THEN
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
              'reason', 'Suma miesięczna faktur (' || new_month_total || ' ' || NEW.currency || ') przekracza limit działu (' || monthly_limit || ' ' || NEW.currency || '). Obecna suma: ' || current_month_total || ' + nowa faktura: ' || NEW.gross_amount
            ),
            'Automatycznie przekazano do działu nadrzędnego - suma miesięczna przekracza limit'
          );

          RAISE NOTICE 'Invoice % forwarded to parent department % (monthly total % would exceed limit %)',
            NEW.invoice_number, parent_dept_name, new_month_total, monthly_limit;
        ELSE
          -- No parent department exists, allow acceptance but log warning
          RAISE NOTICE 'Invoice % exceeds monthly limit but no parent department exists, accepting (total: %, limit: %)',
            NEW.invoice_number, new_month_total, monthly_limit;
        END IF;
      ELSE
        RAISE NOTICE 'Invoice % accepted. Monthly total: % / %',
          NEW.invoice_number, new_month_total, monthly_limit;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger
CREATE TRIGGER invoice_limit_check_trigger
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION check_invoice_limits_and_forward();
