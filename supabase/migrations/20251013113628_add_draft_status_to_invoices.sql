/*
  # Add Draft Status to Invoices

  1. Changes
    - Add 'draft' status to invoice status constraint
    - Change default status from 'waiting' to 'draft' for new invoices
    - Draft invoices are those uploaded by users but not yet submitted to the workflow

  2. Updated Status Flow
    - draft: Robocza - invoice created but not submitted to workflow yet (new default)
    - waiting: Oczekujące - invoice submitted and awaiting verification
    - pending: W weryfikacji - under review
    - in_review: Przeglądane - being reviewed by manager
    - approved: Zatwierdzone - approved by manager
    - accepted: Zaakceptowane - fully accepted and ready for payment
    - rejected: Odrzucone - rejected
    - paid: Opłacone - invoice has been paid
*/

-- Drop existing check constraint
ALTER TABLE invoices DROP CONSTRAINT IF EXISTS invoices_status_check;

-- Add new check constraint with 'draft' status
ALTER TABLE invoices ADD CONSTRAINT invoices_status_check 
  CHECK (status IN ('draft', 'waiting', 'pending', 'in_review', 'approved', 'accepted', 'rejected', 'paid'));

-- Change default status to 'draft'
ALTER TABLE invoices ALTER COLUMN status SET DEFAULT 'draft';