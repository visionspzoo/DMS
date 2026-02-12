/*
  # Remove Auto-Transfer Trigger (Not Reliable)
  
  ## Reason for Removal
  The database trigger approach has limitations:
  1. Edge function requires user authentication token to access KSEF API
  2. Trigger cannot provide user context for authorization
  3. Async HTTP calls from triggers can be unreliable
  
  ## Alternative Solution
  Will implement auto-transfer logic in frontend during fetch operation
  where we have proper user authentication context.
*/

-- Drop trigger and function
DROP TRIGGER IF EXISTS trigger_auto_transfer_ksef_invoice ON ksef_invoices;
DROP FUNCTION IF EXISTS auto_transfer_ksef_invoice();
