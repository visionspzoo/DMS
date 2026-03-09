/*
  # Add purchase request notification types to constraint

  ## Changes
  - Extends the notifications type_check constraint with new types:
    - `invoice_draft_received` - faktura robocza trafia do działu
    - `purchase_request_assigned` - wniosek zakupowy trafił do zatwierdzenia
    - `purchase_request_approved` - wniosek zakupowy zaakceptowany
    - `purchase_request_paid` - wniosek zakupowy oznaczony jako opłacony
    - `purchase_request_rejected` - wniosek zakupowy odrzucony
    - `invoice_paid` - faktura opłacona (jako osobny wyraźny typ)
  - Also adds `invoice_draft_received` and `invoice_paid` to support richer invoice notifications

  ## Notes
  - Existing types are preserved
  - invoice_id is optional (used for invoice notifications; purchase_request_id added separately)
*/

-- Add purchase_request_id column to notifications if not exists
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'notifications' AND column_name = 'purchase_request_id'
  ) THEN
    ALTER TABLE notifications ADD COLUMN purchase_request_id uuid REFERENCES purchase_requests(id) ON DELETE CASCADE;
    CREATE INDEX IF NOT EXISTS idx_notifications_purchase_request_id ON notifications(purchase_request_id);
  END IF;
END $$;

-- Extend the type constraint
ALTER TABLE notifications DROP CONSTRAINT IF EXISTS notifications_type_check;

ALTER TABLE notifications ADD CONSTRAINT notifications_type_check
  CHECK (type = ANY (ARRAY[
    'new_invoice'::text,
    'status_change'::text,
    'pending_review'::text,
    'invoice_assigned'::text,
    'invoice_transferred'::text,
    'ksef_invoice_assigned'::text,
    'new_contract'::text,
    'contract_status_change'::text,
    'duplicate_detected'::text,
    'invoice_draft_received'::text,
    'invoice_paid'::text,
    'purchase_request_assigned'::text,
    'purchase_request_approved'::text,
    'purchase_request_paid'::text,
    'purchase_request_rejected'::text
  ]));
