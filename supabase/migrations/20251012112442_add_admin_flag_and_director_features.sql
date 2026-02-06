/*
  # Add Admin Flag and Director Features

  ## Overview
  This migration transforms the role system to use an is_admin flag and adds comprehensive director features.

  ## 1. Changes to `profiles` table
    - Add `is_admin` boolean flag (default false) - replaces Administrator role
    - Update role constraint to remove Administrator from valid roles
    - Keep roles: CEO, Dyrektor, Kierownik, Specjalista

  ## 2. New Tables
  
  ### `departments`
  Department management by directors:
    - `id` (uuid, primary key)
    - `name` (text, unique) - Department name
    - `created_by` (uuid) - Director who created the department
    - `created_at` (timestamptz) - Creation timestamp
    - `updated_at` (timestamptz) - Last update timestamp

  ### `manager_limits`
  Spending limits for managers set by directors:
    - `id` (uuid, primary key)
    - `manager_id` (uuid) - Reference to manager profile
    - `set_by` (uuid) - Director who set the limit
    - `single_invoice_limit` (decimal) - Maximum amount for single invoice
    - `monthly_limit` (decimal) - Maximum total amount per month
    - `created_at` (timestamptz) - Creation timestamp
    - `updated_at` (timestamptz) - Last update timestamp

  ### `department_managers`
  Links managers to departments:
    - `id` (uuid, primary key)
    - `department_id` (uuid) - Reference to department
    - `manager_id` (uuid) - Reference to manager profile
    - `assigned_by` (uuid) - Director who made the assignment
    - `created_at` (timestamptz) - Assignment timestamp

  ## 3. Modifications to `invoices` table
    - Add `rejection_reason` (text) - Reason for rejection
    - Add `rejected_by` (uuid) - User who rejected the invoice
    - Add `rejected_at` (timestamptz) - Rejection timestamp

  ## 4. Security
    - RLS policies for new tables
    - Update existing policies to use is_admin flag
    - Directors can manage departments and manager limits
    - Managers can view their own limits

  ## 5. Data Migration
    - Convert existing Administrator users to CEO with is_admin = true
*/

-- Add is_admin flag to profiles
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'is_admin'
  ) THEN
    ALTER TABLE profiles ADD COLUMN is_admin boolean DEFAULT false;
  END IF;
END $$;

-- Migrate existing administrators to CEO with is_admin flag
UPDATE profiles
SET role = 'CEO', is_admin = true
WHERE role = 'Administrator';

-- Update role constraint to remove Administrator
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check 
  CHECK (role IN ('CEO', 'Dyrektor', 'Kierownik', 'Specjalista'));

-- Add rejection fields to invoices
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'rejection_reason'
  ) THEN
    ALTER TABLE invoices ADD COLUMN rejection_reason text;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'rejected_by'
  ) THEN
    ALTER TABLE invoices ADD COLUMN rejected_by uuid REFERENCES profiles(id);
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'invoices' AND column_name = 'rejected_at'
  ) THEN
    ALTER TABLE invoices ADD COLUMN rejected_at timestamptz;
  END IF;
END $$;

-- Create departments table
CREATE TABLE IF NOT EXISTS departments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create manager_limits table
CREATE TABLE IF NOT EXISTS manager_limits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  manager_id uuid UNIQUE NOT NULL REFERENCES profiles(id),
  set_by uuid NOT NULL REFERENCES profiles(id),
  single_invoice_limit decimal(15,2) NOT NULL DEFAULT 0,
  monthly_limit decimal(15,2) NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create department_managers table
CREATE TABLE IF NOT EXISTS department_managers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  manager_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, manager_id)
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_departments_created_by ON departments(created_by);
CREATE INDEX IF NOT EXISTS idx_manager_limits_manager_id ON manager_limits(manager_id);
CREATE INDEX IF NOT EXISTS idx_department_managers_department_id ON department_managers(department_id);
CREATE INDEX IF NOT EXISTS idx_department_managers_manager_id ON department_managers(manager_id);
CREATE INDEX IF NOT EXISTS idx_profiles_is_admin ON profiles(is_admin);
CREATE INDEX IF NOT EXISTS idx_invoices_rejected_by ON invoices(rejected_by);

-- Enable RLS
ALTER TABLE departments ENABLE ROW LEVEL SECURITY;
ALTER TABLE manager_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE department_managers ENABLE ROW LEVEL SECURITY;

-- Departments policies
CREATE POLICY "Everyone can view departments"
  ON departments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Directors can create departments"
  ON departments FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
  );

CREATE POLICY "Directors can update own departments"
  ON departments FOR UPDATE
  TO authenticated
  USING (created_by = auth.uid())
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Admins can manage all departments"
  ON departments FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Manager limits policies
CREATE POLICY "Everyone can view manager limits"
  ON manager_limits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Directors can set manager limits"
  ON manager_limits FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
  );

CREATE POLICY "Directors can update manager limits"
  ON manager_limits FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
  );

CREATE POLICY "Admins can manage all limits"
  ON manager_limits FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Department managers policies
CREATE POLICY "Everyone can view department managers"
  ON department_managers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Directors can assign managers to departments"
  ON department_managers FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
  );

CREATE POLICY "Directors can remove manager assignments"
  ON department_managers FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Dyrektor'
    )
  );

CREATE POLICY "Admins can manage all assignments"
  ON department_managers FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Update existing profiles policies to use is_admin
DROP POLICY IF EXISTS "Administrators can update any profile" ON profiles;
DROP POLICY IF EXISTS "Administrators can insert profiles" ON profiles;

CREATE POLICY "Admins can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.is_admin = true
    )
  );

CREATE POLICY "Admins can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND p.is_admin = true
    )
  );

-- Update existing invoices policies to use is_admin
DROP POLICY IF EXISTS "Administrators can update any invoice" ON invoices;
DROP POLICY IF EXISTS "Administrators can delete invoices" ON invoices;

CREATE POLICY "Admins can update any invoice"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can delete invoices"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Update workflow rules policies to use is_admin
DROP POLICY IF EXISTS "Only administrators can modify workflow rules" ON workflow_rules;

CREATE POLICY "Only admins can modify workflow rules"
  ON workflow_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_departments_updated_at ON departments;
CREATE TRIGGER update_departments_updated_at
  BEFORE UPDATE ON departments
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_manager_limits_updated_at ON manager_limits;
CREATE TRIGGER update_manager_limits_updated_at
  BEFORE UPDATE ON manager_limits
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();
