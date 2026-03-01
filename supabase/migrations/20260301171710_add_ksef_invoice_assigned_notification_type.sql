/*
  # Add ksef_invoice_assigned to notifications type check

  ## Problem
  The notifications_type_check constraint does not include 'ksef_invoice_assigned',
  causing inserts to fail when transferring KSEF invoices that trigger this notification type.

  ## Fix
  Drop the old check constraint and recreate it with 'ksef_invoice_assigned' added.
*/

ALTER TABLE notifications DROP CONSTRAINT notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'new_invoice'::text,
    'status_change'::text,
    'pending_review'::text,
    'invoice_assigned'::text,
    'ksef_invoice_assigned'::text,
    'new_contract'::text,
    'contract_status_change'::text,
    'duplicate_detected'::text
  ]));
