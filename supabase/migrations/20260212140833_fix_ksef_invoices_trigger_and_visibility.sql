/*
  # Fix KSEF invoices trigger and visibility policies

  1. Changes
    - Fix auto_assign_ksef_department_by_nip() function to use correct column name (transferred_to_department_id instead of department_id)
    - Update RLS policies for proper visibility:
      - Unassigned invoices: visible to Admin, users with ksef config access, Directors, Managers, CEO
      - Assigned invoices: visible to Admin, Directors, CEO
    
  2. Security
    - Maintain RLS protection
    - Only authorized roles can view invoices
*/

-- Drop existing trigger temporarily
DROP TRIGGER IF EXISTS trigger_auto_assign_ksef_department ON ksef_invoices;

-- Fix the auto-assign function to use correct column name
CREATE OR REPLACE FUNCTION auto_assign_ksef_department_by_nip()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_department_id uuid;
BEGIN
  -- Only proceed if supplier_nip is provided and department is not already assigned
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
$$;

-- Recreate the trigger
CREATE TRIGGER trigger_auto_assign_ksef_department
  BEFORE INSERT ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_ksef_department_by_nip();

-- Drop existing SELECT policies
DROP POLICY IF EXISTS "Admins can view all KSEF invoices" ON ksef_invoices;
DROP POLICY IF EXISTS "Users with KSEF config can view unassigned invoices" ON ksef_invoices;
DROP POLICY IF EXISTS "Directors and CEO can view unassigned" ON ksef_invoices;
DROP POLICY IF EXISTS "Specialists can view their department invoices" ON ksef_invoices;
DROP POLICY IF EXISTS "Allow read access for users with KSEF access" ON ksef_invoices;

-- New comprehensive SELECT policy for unassigned invoices
-- Visible to: Admin, users with ksef_config access, Directors, Managers, CEO
CREATE POLICY "View unassigned KSEF invoices"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    transferred_to_department_id IS NULL
    AND transferred_to_invoice_id IS NULL
    AND (
      -- Admins can see all
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      -- Users with KSEF config access
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.can_access_ksef_config = true
      )
      OR
      -- Directors
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Dyrektor'
      )
      OR
      -- Managers
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Kierownik'
      )
      OR
      -- CEO
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'CEO'
      )
    )
  );

-- New policy for assigned invoices
-- Visible to: Admin, Directors, CEO
CREATE POLICY "View assigned KSEF invoices"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (
    (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
    AND (
      -- Admins can see all
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.is_admin = true
      )
      OR
      -- Directors
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Dyrektor'
      )
      OR
      -- CEO
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'CEO'
      )
    )
  );

-- Update policy for updating KSEF invoices (transferring)
DROP POLICY IF EXISTS "Users can update KSEF invoices" ON ksef_invoices;

CREATE POLICY "Update KSEF invoices for transfer"
  ON ksef_invoices FOR UPDATE
  TO authenticated
  USING (
    -- Admins can update all
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- Users with KSEF config access
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.can_access_ksef_config = true
    )
    OR
    -- Directors
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
    OR
    -- Managers
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Kierownik'
    )
    OR
    -- CEO
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
  )
  WITH CHECK (true);
