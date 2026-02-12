/*
  # Add Automatic Transfer for Auto-Assigned KSEF Invoices
  
  ## Problem
  When KSEF invoices are automatically assigned to departments (via NIP mapping),
  they remain in ksef_invoices table and are not automatically transferred to
  the invoices table with PDF preview.
  
  ## Solution
  Create a trigger that automatically calls the transfer-ksef-invoice edge function
  when a KSEF invoice is inserted with transferred_to_department_id set but
  transferred_to_invoice_id is null (meaning it's auto-assigned but not transferred yet).
  
  ## Implementation
  1. Create a function that uses pg_net to call the transfer-ksef-invoice edge function
  2. Create an AFTER INSERT trigger that fires when auto-assignment is detected
  3. The edge function will handle the full transfer process asynchronously
  
  ## Security
  - Uses service role key for authorization
  - Runs asynchronously to not block the insert operation
  - Handles errors gracefully without failing the original insert
*/

-- Create function to auto-transfer KSEF invoice
CREATE OR REPLACE FUNCTION auto_transfer_ksef_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url text;
  v_service_role_key text;
  v_request_id bigint;
BEGIN
  -- Only proceed if invoice is auto-assigned but not yet transferred
  IF NEW.transferred_to_department_id IS NOT NULL 
     AND NEW.transferred_to_invoice_id IS NULL THEN
    
    -- Get Supabase URL and service role key from environment
    v_supabase_url := current_setting('app.settings.supabase_url', true);
    v_service_role_key := current_setting('app.settings.service_role_key', true);
    
    -- If env vars not available, try to get from secrets (Supabase managed)
    IF v_supabase_url IS NULL THEN
      v_supabase_url := current_setting('request.headers', true)::json->>'x-forwarded-host';
      IF v_supabase_url IS NOT NULL THEN
        v_supabase_url := 'https://' || v_supabase_url;
      END IF;
    END IF;
    
    -- Only proceed if we have the URL
    IF v_supabase_url IS NOT NULL THEN
      -- Make async HTTP request to transfer edge function
      SELECT INTO v_request_id net.http_post(
        url := v_supabase_url || '/functions/v1/transfer-ksef-invoice',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || COALESCE(v_service_role_key, '')
        ),
        body := jsonb_build_object(
          'ksefInvoiceId', NEW.id,
          'departmentId', NEW.transferred_to_department_id
        )
      );
      
      RAISE NOTICE 'Auto-transfer initiated for KSEF invoice % (request_id: %)', 
        NEW.invoice_number, v_request_id;
    ELSE
      RAISE WARNING 'Cannot auto-transfer KSEF invoice %: Supabase URL not configured', 
        NEW.invoice_number;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Create trigger for auto-transfer
DROP TRIGGER IF EXISTS trigger_auto_transfer_ksef_invoice ON ksef_invoices;

CREATE TRIGGER trigger_auto_transfer_ksef_invoice
  AFTER INSERT ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_transfer_ksef_invoice();

-- Add helpful comment
COMMENT ON FUNCTION auto_transfer_ksef_invoice() IS
'Automatically transfers KSEF invoices to the invoices table when they are auto-assigned to a department.
Uses pg_net to asynchronously call the transfer-ksef-invoice edge function.';

COMMENT ON TRIGGER trigger_auto_transfer_ksef_invoice ON ksef_invoices IS
'Triggers automatic transfer of auto-assigned KSEF invoices to the invoices table with full PDF support.';
