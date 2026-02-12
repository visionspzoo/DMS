/*
  # Fix Auto-Transfer KSEF Invoices with Hardcoded Configuration
  
  ## Changes
  1. Update auto_transfer_ksef_invoice() function to use hardcoded Supabase URL and anon key
  2. This ensures the trigger works reliably without needing environment variables
  3. Using anon key is safe as edge function has its own RLS protection
  
  ## Note
  The anon key is public and safe to use here as it only allows authenticated access
  which is controlled by RLS policies in the edge function.
*/

-- Drop existing function to recreate with hardcoded config
DROP FUNCTION IF EXISTS auto_transfer_ksef_invoice() CASCADE;

-- Create improved function with hardcoded configuration
CREATE OR REPLACE FUNCTION auto_transfer_ksef_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_supabase_url text := 'https://mzncjizbhvrqyyzclqxi.supabase.co';
  v_anon_key text := 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im16bmNqaXpiaHZycXl5emNscXhpIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzAyOTU4NzgsImV4cCI6MjA4NTg3MTg3OH0.ytEULytrVrtmNFdc728DJWhh3bL1J6kQBen5DROeCCU';
  v_request_id bigint;
BEGIN
  -- Only proceed if invoice is auto-assigned but not yet transferred
  IF NEW.transferred_to_department_id IS NOT NULL 
     AND NEW.transferred_to_invoice_id IS NULL THEN
    
    BEGIN
      -- Make async HTTP request to transfer edge function
      SELECT INTO v_request_id net.http_post(
        url := v_supabase_url || '/functions/v1/transfer-ksef-invoice',
        headers := jsonb_build_object(
          'Content-Type', 'application/json',
          'Authorization', 'Bearer ' || v_anon_key,
          'apikey', v_anon_key
        ),
        body := jsonb_build_object(
          'ksefInvoiceId', NEW.id::text,
          'departmentId', NEW.transferred_to_department_id::text,
          'autoTransfer', true
        )
      );
      
      RAISE NOTICE '🔄 Auto-transfer initiated for KSEF invoice % to department % (request_id: %)', 
        NEW.invoice_number, NEW.transferred_to_department_id, v_request_id;
        
    EXCEPTION WHEN OTHERS THEN
      -- Log error but don't fail the insert
      RAISE WARNING '⚠️ Failed to initiate auto-transfer for KSEF invoice %: %', 
        NEW.invoice_number, SQLERRM;
    END;
  END IF;
  
  RETURN NEW;
END;
$$;

-- Recreate trigger
DROP TRIGGER IF EXISTS trigger_auto_transfer_ksef_invoice ON ksef_invoices;

CREATE TRIGGER trigger_auto_transfer_ksef_invoice
  AFTER INSERT ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_transfer_ksef_invoice();

-- Add helpful comments
COMMENT ON FUNCTION auto_transfer_ksef_invoice() IS
'Automatically transfers KSEF invoices to the invoices table when they are auto-assigned to a department.
Uses pg_net to asynchronously call the transfer-ksef-invoice edge function with hardcoded credentials.
Errors are logged but do not fail the original insert operation.';

COMMENT ON TRIGGER trigger_auto_transfer_ksef_invoice ON ksef_invoices IS
'Triggers automatic transfer of auto-assigned KSEF invoices to the invoices table with full PDF support.
Executes asynchronously after invoice insert completes.';
