/*
  # Update Department Limits to Use PLN Amounts

  1. Changes
    - Update the monthly limit check function to use `pln_gross_amount` instead of `gross_amount`
    - This ensures all limits are calculated in PLN regardless of invoice currency
    - Foreign invoices will be automatically converted to PLN using NBP exchange rates
    
  2. Notes
    - Monthly limits in departments table are always in PLN
    - All calculations now use `pln_gross_amount` for accurate limit enforcement
    - Exchange rates are fetched automatically during OCR processing
*/

-- Update function to use PLN amounts for limit checks
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
  IF NEW.status = 'accepted' AND (OLD.status IS DISTINCT FROM 'accepted') THEN
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

    IF monthly_limit IS NOT NULL THEN
      SELECT COALESCE(SUM(pln_gross_amount), 0)
      INTO current_month_total
      FROM invoices
      WHERE department_id = NEW.department_id
        AND id != NEW.id
        AND status IN ('accepted', 'paid')
        AND DATE_TRUNC('month', created_at) = DATE_TRUNC('month', NEW.created_at);

      new_month_total := current_month_total + COALESCE(NEW.pln_gross_amount, NEW.gross_amount);

      IF new_month_total > monthly_limit THEN
        IF parent_dept_id IS NOT NULL THEN
          NEW.status := 'waiting';
          NEW.department_id := parent_dept_id;
          
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
              'reason', 'Suma miesięczna faktur (' || ROUND(new_month_total, 2) || ' PLN) przekracza limit działu (' || ROUND(monthly_limit, 2) || ' PLN). Obecna suma: ' || ROUND(current_month_total, 2) || ' PLN + nowa faktura: ' || ROUND(COALESCE(NEW.pln_gross_amount, NEW.gross_amount), 2) || ' PLN'
            ),
            'Automatycznie przekazano do działu nadrzędnego - suma miesięczna przekracza limit'
          );

          RAISE NOTICE 'Invoice % forwarded to parent department % (monthly total % PLN would exceed limit % PLN)',
            NEW.invoice_number, parent_dept_name, new_month_total, monthly_limit;
        ELSE
          RAISE NOTICE 'Invoice % exceeds monthly limit but no parent department exists, accepting (total: % PLN, limit: % PLN)',
            NEW.invoice_number, new_month_total, monthly_limit;
        END IF;
      ELSE
        RAISE NOTICE 'Invoice % accepted. Monthly total: % PLN / % PLN',
          NEW.invoice_number, new_month_total, monthly_limit;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
