/*
  # Add Department Hierarchy and Manager Assignment

  1. Changes to `departments` table
    - Add `parent_department_id` column to support hierarchical department structure
    - Add `manager_id` column to directly assign a manager to a department
    - Both columns are optional (nullable) and reference appropriate tables
  
  2. Security
    - No changes to existing RLS policies
    - New columns inherit existing security policies
*/

-- Add parent_department_id column to support hierarchical departments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'parent_department_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN parent_department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Add manager_id column to directly assign a manager
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'departments' AND column_name = 'manager_id'
  ) THEN
    ALTER TABLE departments ADD COLUMN manager_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

-- Create index for better query performance on parent_department_id
CREATE INDEX IF NOT EXISTS idx_departments_parent_department_id ON departments(parent_department_id);

-- Create index for better query performance on manager_id
CREATE INDEX IF NOT EXISTS idx_departments_manager_id ON departments(manager_id);