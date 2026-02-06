/*
  # Fix KSEF Auto-Assignment Trigger

  ## Changes
  - Update trigger function to use correct column name `transferred_to_department_id` instead of `department_id`
  - This fixes automatic department assignment for KSEF invoices based on NIP mappings
*/

CREATE OR REPLACE FUNCTION auto_assign_ksef_department_by_nip()
RETURNS TRIGGER AS $$
DECLARE
  v_department_id uuid;
BEGIN
  -- Only proceed if supplier_nip is provided and department not yet assigned
  IF NEW.supplier_nip IS NOT NULL AND NEW.transferred_to_department_id IS NULL THEN
    -- Look up department mapping for this NIP
    SELECT department_id INTO v_department_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;
    
    -- If mapping found, assign the department
    IF v_department_id IS NOT NULL THEN
      NEW.transferred_to_department_id := v_department_id;
      RAISE NOTICE 'KSEF Invoice % auto-assigned to department % based on NIP %',
        NEW.invoice_number, v_department_id, NEW.supplier_nip;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;