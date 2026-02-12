/*
  # Update Cost Centers table - Remove department dependency

  1. Changes
    - Drop existing RLS policies that depend on department_id
    - Remove `department_id` column (all departments share same cost centers)
    - Add `display_order` column for ordering in dropdowns
    - Recreate simple RLS policies for global cost centers
  
  2. Notes
    - Cost centers (MPK) are now global and shared across all departments
    - Existing invoices.cost_center_id references remain valid
*/

DROP POLICY IF EXISTS "Users can view cost centers in accessible departments" ON cost_centers;
DROP POLICY IF EXISTS "Authorized users can create cost centers" ON cost_centers;
DROP POLICY IF EXISTS "Authorized users can update cost centers" ON cost_centers;
DROP POLICY IF EXISTS "Authorized users can delete cost centers" ON cost_centers;

DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cost_centers' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE cost_centers DROP COLUMN department_id CASCADE;
  END IF;
END $$;

DO $$ 
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'cost_centers' AND column_name = 'display_order'
  ) THEN
    ALTER TABLE cost_centers ADD COLUMN display_order integer NOT NULL DEFAULT 0;
  END IF;
END $$;

CREATE POLICY "All authenticated users can view cost centers"
  ON cost_centers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only admins can insert cost centers"
  ON cost_centers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Only admins can update cost centers"
  ON cost_centers FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Only admins can delete cost centers"
  ON cost_centers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_cost_centers_display_order ON cost_centers(display_order);
CREATE INDEX IF NOT EXISTS idx_cost_centers_is_active ON cost_centers(is_active);