/*
  # Create cost centers table for department cost tracking

  1. New Tables
    - `cost_centers`
      - `id` (uuid, primary key)
      - `department_id` (uuid, foreign key to departments)
      - `code` (text, unique code for cost center)
      - `description` (text, description of cost center)
      - `is_active` (boolean, whether cost center is active)
      - `created_at` (timestamptz, creation timestamp)
      - `updated_at` (timestamptz, last update timestamp)
  
  2. Changes
    - Add `cost_center_id` column to `invoices` table as optional foreign key
    
  3. Security
    - Enable RLS on `cost_centers` table
    - Only authenticated users can view cost centers
    - Only Admins, Directors, and Managers can manage cost centers
*/

-- Create cost_centers table
CREATE TABLE IF NOT EXISTS cost_centers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  code text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create unique constraint on code within department
CREATE UNIQUE INDEX IF NOT EXISTS cost_centers_department_code_unique 
  ON cost_centers(department_id, code);

-- Add cost_center_id to invoices table
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'cost_center_id'
  ) THEN
    ALTER TABLE invoices ADD COLUMN cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Enable RLS on cost_centers
ALTER TABLE cost_centers ENABLE ROW LEVEL SECURITY;

-- Policy: View cost centers for authenticated users in their accessible departments
CREATE POLICY "Users can view cost centers in accessible departments"
  ON cost_centers FOR SELECT
  TO authenticated
  USING (
    -- Admins can see all
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- Directors can see their department's cost centers
    EXISTS (
      SELECT 1 FROM departments
      WHERE departments.id = cost_centers.department_id
      AND departments.director_id = auth.uid()
    )
    OR
    -- CEO can see all
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
    OR
    -- Users can see cost centers from their department
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.department_id = cost_centers.department_id
    )
    OR
    -- Users with additional department access
    EXISTS (
      SELECT 1 FROM user_department_access
      WHERE user_department_access.user_id = auth.uid()
      AND user_department_access.department_id = cost_centers.department_id
    )
  );

-- Policy: Insert cost centers (Admins, Directors, Managers)
CREATE POLICY "Authorized users can create cost centers"
  ON cost_centers FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Admins can create in any department
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- Directors can create in their department
    EXISTS (
      SELECT 1 FROM departments
      WHERE departments.id = cost_centers.department_id
      AND departments.director_id = auth.uid()
    )
    OR
    -- Managers can create in their department
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Kierownik'
      AND profiles.department_id = cost_centers.department_id
    )
  );

-- Policy: Update cost centers (Admins, Directors, Managers)
CREATE POLICY "Authorized users can update cost centers"
  ON cost_centers FOR UPDATE
  TO authenticated
  USING (
    -- Admins can update all
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- Directors can update their department's cost centers
    EXISTS (
      SELECT 1 FROM departments
      WHERE departments.id = cost_centers.department_id
      AND departments.director_id = auth.uid()
    )
    OR
    -- Managers can update their department's cost centers
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Kierownik'
      AND profiles.department_id = cost_centers.department_id
    )
  )
  WITH CHECK (
    -- Same permissions for the updated data
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    EXISTS (
      SELECT 1 FROM departments
      WHERE departments.id = cost_centers.department_id
      AND departments.director_id = auth.uid()
    )
    OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Kierownik'
      AND profiles.department_id = cost_centers.department_id
    )
  );

-- Policy: Delete cost centers (Admins, Directors)
CREATE POLICY "Authorized users can delete cost centers"
  ON cost_centers FOR DELETE
  TO authenticated
  USING (
    -- Admins can delete all
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    OR
    -- Directors can delete their department's cost centers
    EXISTS (
      SELECT 1 FROM departments
      WHERE departments.id = cost_centers.department_id
      AND departments.director_id = auth.uid()
    )
  );

-- Create function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_cost_centers_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

-- Create trigger for updated_at
DROP TRIGGER IF EXISTS trigger_update_cost_centers_timestamp ON cost_centers;
CREATE TRIGGER trigger_update_cost_centers_timestamp
  BEFORE UPDATE ON cost_centers
  FOR EACH ROW
  EXECUTE FUNCTION update_cost_centers_updated_at();