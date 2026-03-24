/*
  # Fix conflicting invoice approval triggers

  ## Problem
  Two BEFORE UPDATE triggers were fighting each other on director approval:
  1. `auto_approve_director_within_limits` (via `check_director_limits_trigger`) — approved correctly
  2. `handle_simple_invoice_approval` (via `on_simple_invoice_approval`) — ran AFTER and re-forwarded to CEO

  `handle_simple_invoice_approval` checks limits using `auth.uid()` (who is clicking),
  but when the director's monthly limit is exceeded it always forwards to CEO,
  even if the invoice was already handled correctly by `auto_approve_director_within_limits`.

  The logic in `handle_simple_invoice_approval` is fully redundant — it duplicates
  what `z0_handle_invoice_approval_trigger` (handle_invoice_approval) already does.
  Removing it fixes the conflict.

  ## Fix
  - Drop the `on_simple_invoice_approval` trigger
  - Replace `handle_simple_invoice_approval` with a no-op pass-through

  ## Also fixes
  - All currently stuck invoices in `waiting` status assigned to CEO
    (where last audit log shows `approved_by_director_within_limits`)
    are corrected to `accepted` status.
*/

-- Drop the conflicting trigger
DROP TRIGGER IF EXISTS on_simple_invoice_approval ON invoices;

-- Replace function with a pass-through (keep function in case referenced elsewhere)
CREATE OR REPLACE FUNCTION handle_simple_invoice_approval()
RETURNS trigger AS $$
BEGIN
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Fix all invoices that are stuck in 'waiting' assigned to CEO
-- but whose last audit log says they were already approved by director within limits.
-- These got stuck due to the conflicting trigger.
UPDATE invoices
SET 
  status = 'accepted',
  current_approver_id = NULL,
  approved_by_director_at = COALESCE(approved_by_director_at, NOW())
WHERE status = 'waiting'
  AND current_approver_id IN (
    SELECT id FROM profiles WHERE role = 'CEO'
  )
  AND id IN (
    SELECT DISTINCT invoice_id
    FROM audit_logs
    WHERE action = 'approved_by_director_within_limits'
  )
  AND id NOT IN (
    SELECT DISTINCT invoice_id
    FROM audit_logs
    WHERE action IN ('forwarded_to_ceo', 'forwarded_to_ceo_limits_exceeded')
      AND created_at > (
        SELECT MAX(al2.created_at)
        FROM audit_logs al2
        WHERE al2.invoice_id = audit_logs.invoice_id
          AND al2.action = 'approved_by_director_within_limits'
      )
  );
