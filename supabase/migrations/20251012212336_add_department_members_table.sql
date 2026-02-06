/*
  # Add department_members table for user assignments

  1. New Tables
    - `department_members`
      - `id` (uuid, primary key)
      - `department_id` (uuid, references departments)
      - `user_id` (uuid, references profiles)
      - `assigned_by` (uuid, references profiles)
      - `created_at` (timestamptz)
  
  2. Security
    - Enable RLS on `department_members` table
    - Add policy for admins to manage department members
    - Add policy for users to read their own department memberships
  
  3. Indexes
    - Add index on department_id for faster lookups
    - Add index on user_id for faster lookups
    - Add unique constraint on (department_id, user_id) to prevent duplicates
*/

CREATE TABLE IF NOT EXISTS department_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  department_id uuid NOT NULL REFERENCES departments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  assigned_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  UNIQUE(department_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_department_members_department_id ON department_members(department_id);
CREATE INDEX IF NOT EXISTS idx_department_members_user_id ON department_members(user_id);

ALTER TABLE department_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can manage department members"
  ON department_members
  FOR ALL
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

CREATE POLICY "Users can read their own department memberships"
  ON department_members
  FOR SELECT
  TO authenticated
  USING (user_id = auth.uid());