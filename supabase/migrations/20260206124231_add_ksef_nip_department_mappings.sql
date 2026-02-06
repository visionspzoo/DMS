/*
  # Add NIP to Department Mappings for KSEF Invoices

  ## New Tables
  - `ksef_nip_department_mappings`
    - `id` (uuid, primary key)
    - `nip` (text, unique) - NIP number to map
    - `department_id` (uuid) - Department to assign invoices to
    - `created_by` (uuid) - User who created the mapping
    - `created_at` (timestamp)

  ## Security
  - Enable RLS on table
  - Specialists cannot add/delete mappings
  - Managers, Directors, and CEO can manage mappings
  - All authenticated users can view mappings

  ## Auto-Assignment
  - Create trigger to automatically assign department to KSEF invoices based on NIP
*/

-- Create the mappings table
CREATE TABLE IF NOT EXISTS ksef_nip_department_mappings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  nip text UNIQUE NOT NULL,
  department_id uuid REFERENCES departments(id) ON DELETE CASCADE NOT NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now() NOT NULL
);

-- Enable RLS
ALTER TABLE ksef_nip_department_mappings ENABLE ROW LEVEL SECURITY;

-- All authenticated users can view mappings
CREATE POLICY "All authenticated users can view NIP mappings"
  ON ksef_nip_department_mappings FOR SELECT
  TO authenticated
  USING (true);

-- Only non-specialists can insert mappings
CREATE POLICY "Non-specialists can add NIP mappings"
  ON ksef_nip_department_mappings FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role != 'specialist'
    )
  );

-- Only non-specialists can delete mappings
CREATE POLICY "Non-specialists can delete NIP mappings"
  ON ksef_nip_department_mappings FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role != 'specialist'
    )
  );

-- Create function to auto-assign department based on NIP for KSEF invoices
CREATE OR REPLACE FUNCTION auto_assign_ksef_department_by_nip()
RETURNS TRIGGER AS $$
DECLARE
  v_department_id uuid;
BEGIN
  -- Only proceed if supplier_nip is provided and department_id is NULL
  IF NEW.supplier_nip IS NOT NULL AND NEW.department_id IS NULL THEN
    -- Look up department mapping for this NIP
    SELECT department_id INTO v_department_id
    FROM ksef_nip_department_mappings
    WHERE nip = NEW.supplier_nip
    LIMIT 1;
    
    -- If mapping found, assign the department
    IF v_department_id IS NOT NULL THEN
      NEW.department_id := v_department_id;
      RAISE NOTICE 'KSEF Invoice % auto-assigned to department % based on NIP %',
        NEW.invoice_number, v_department_id, NEW.supplier_nip;
    END IF;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger for auto-assignment
DROP TRIGGER IF EXISTS trigger_auto_assign_ksef_department ON ksef_invoices;
CREATE TRIGGER trigger_auto_assign_ksef_department
  BEFORE INSERT ON ksef_invoices
  FOR EACH ROW
  EXECUTE FUNCTION auto_assign_ksef_department_by_nip();

-- Create index for faster NIP lookups
CREATE INDEX IF NOT EXISTS idx_ksef_nip_mappings_nip ON ksef_nip_department_mappings(nip);