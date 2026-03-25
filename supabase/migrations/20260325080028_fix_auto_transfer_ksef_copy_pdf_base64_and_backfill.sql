/*
  # Fix: Copy pdf_base64 from ksef_invoices during transfer and backfill existing

  ## Problem
  The `auto_transfer_ksef_to_invoices` trigger copies most fields from ksef_invoices
  to invoices, but was missing `pdf_base64`. As a result, KSeF invoices that were
  transferred to the `invoices` table had no PDF — making the export API return
  null for pdf_base64 even when include_pdf=true.

  ## Fix
  1. Update the trigger function to include pdf_base64 in the INSERT
  2. Backfill all existing invoices from ksef_invoices where pdf_base64 is missing
*/

-- Fix the trigger to copy pdf_base64
CREATE OR REPLACE FUNCTION public.auto_transfer_ksef_to_invoices()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $function$
DECLARE
v_assigned_user_id uuid;
v_current_approver_id uuid;
v_new_invoice_id uuid;
v_tax_amount numeric;
v_dept_manager_id uuid;
v_dept_director_id uuid;
v_invoice_owner uuid;
BEGIN
IF NEW.transferred_to_department_id IS NOT NULL AND NEW.transferred_to_invoice_id IS NULL THEN

SELECT d.manager_id, d.director_id
INTO v_dept_manager_id, v_dept_director_id
FROM departments d
WHERE d.id = NEW.transferred_to_department_id;

SELECT assigned_user_id INTO v_assigned_user_id
FROM ksef_nip_department_mappings
WHERE nip = NEW.supplier_nip
LIMIT 1;

IF v_assigned_user_id IS NOT NULL THEN
v_current_approver_id := v_assigned_user_id;
ELSIF v_dept_manager_id IS NOT NULL THEN
v_current_approver_id := v_dept_manager_id;
ELSE
v_current_approver_id := v_dept_director_id;
END IF;

v_invoice_owner := COALESCE(v_dept_manager_id, v_dept_director_id, NEW.fetched_by);

v_tax_amount := NEW.tax_amount;
IF v_tax_amount IS NULL THEN
v_tax_amount := NEW.gross_amount - NEW.net_amount;
END IF;

INSERT INTO invoices (
invoice_number,
supplier_name,
supplier_nip,
buyer_name,
buyer_nip,
gross_amount,
net_amount,
tax_amount,
currency,
issue_date,
status,
uploaded_by,
department_id,
current_approver_id,
description,
source,
pln_gross_amount,
exchange_rate,
pdf_base64
) VALUES (
NEW.invoice_number,
NEW.supplier_name,
NEW.supplier_nip,
NEW.buyer_name,
NEW.buyer_nip,
NEW.gross_amount,
NEW.net_amount,
v_tax_amount,
NEW.currency,
NEW.issue_date,
'draft',
v_invoice_owner,
NEW.transferred_to_department_id,
v_current_approver_id,
'Faktura z KSEF - dodana jako wersja robocza',
'ksef',
NEW.gross_amount,
1.0,
NEW.pdf_base64
)
RETURNING id INTO v_new_invoice_id;

UPDATE ksef_invoices
SET
transferred_to_invoice_id = v_new_invoice_id,
transferred_at = NOW()
WHERE id = NEW.id;

END IF;

RETURN NEW;
END;
$function$;

-- Backfill pdf_base64 for all existing invoices transferred from ksef_invoices
UPDATE invoices i
SET pdf_base64 = ki.pdf_base64
FROM ksef_invoices ki
WHERE ki.transferred_to_invoice_id = i.id
  AND i.pdf_base64 IS NULL
  AND ki.pdf_base64 IS NOT NULL;
