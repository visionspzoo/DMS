/*
  # Add Auto-Assign Trigger for Invoice Updates

  ## Problem
  - Auto-assign trigger only works on INSERT, not on UPDATE
  - When KSEF invoice is confirmed and status changes to 'waiting', no approver is assigned
  - This breaks the approval workflow for KSEF invoices

  ## Solution
  - Add BEFORE UPDATE trigger to auto-assign approver when status changes to 'waiting'
  - Also add AFTER UPDATE trigger for logging the assignment

  ## Changes
  - New trigger: auto_assign_invoice_update_trigger (BEFORE UPDATE)
  - New trigger: invoice_assignment_log_update_trigger (AFTER UPDATE)
*/

-- Add BEFORE UPDATE trigger for auto-assigning approver
DROP TRIGGER IF EXISTS auto_assign_invoice_update_trigger ON invoices;
CREATE TRIGGER auto_assign_invoice_update_trigger
    BEFORE UPDATE OF status ON invoices
    FOR EACH ROW
    WHEN (NEW.status = 'waiting' AND NEW.current_approver_id IS NULL)
    EXECUTE FUNCTION auto_assign_invoice_to_approver();

-- Add AFTER UPDATE trigger for logging the assignment
DROP TRIGGER IF EXISTS invoice_assignment_log_update_trigger ON invoices;
CREATE TRIGGER invoice_assignment_log_update_trigger
    AFTER UPDATE OF status, current_approver_id ON invoices
    FOR EACH ROW
    WHEN (NEW.current_approver_id IS NOT NULL AND OLD.current_approver_id IS NULL AND NEW.status = 'waiting')
    EXECUTE FUNCTION log_invoice_assignment();