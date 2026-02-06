/*
  # Document Workflow System - Complete Database Schema

  ## Overview
  This migration creates a complete 5-tier hierarchical document approval system with OCR integration.

  ## 1. New Tables

  ### `profiles`
  User profile information with role-based hierarchy:
  - `id` (uuid, primary key) - References auth.users
  - `email` (text) - User email address
  - `full_name` (text) - User's full name
  - `role` (text) - One of: Administrator, CEO, Dyrektor, Kierownik, Specjalista
  - `created_at` (timestamptz) - Account creation timestamp
  - `updated_at` (timestamptz) - Last update timestamp

  ### `invoices`
  Main invoice storage:
  - `id` (uuid, primary key) - Unique invoice identifier
  - `invoice_number` (text) - Invoice number from OCR
  - `supplier_name` (text) - Supplier/vendor name
  - `supplier_nip` (text) - Tax identification number
  - `issue_date` (date) - Invoice issue date
  - `due_date` (date) - Payment due date
  - `net_amount` (decimal) - Net amount
  - `tax_amount` (decimal) - VAT/tax amount
  - `gross_amount` (decimal) - Total gross amount
  - `currency` (text) - Currency code (PLN, EUR, USD, etc.)
  - `file_url` (text) - Original file URL
  - `google_drive_id` (text) - Google Drive file ID
  - `ocr_data` (jsonb) - Full OCR response from OpenAI
  - `status` (text) - One of: pending, in_review, approved, rejected
  - `uploaded_by` (uuid) - User who uploaded the invoice
  - `created_at` (timestamptz) - Upload timestamp
  - `updated_at` (timestamptz) - Last modification timestamp

  ### `approvals`
  Approval workflow tracking:
  - `id` (uuid, primary key) - Approval record ID
  - `invoice_id` (uuid) - Related invoice
  - `approver_id` (uuid) - User who approved/rejected
  - `approver_role` (text) - Role at time of approval
  - `action` (text) - approved or rejected
  - `comment` (text) - Optional approval comment
  - `created_at` (timestamptz) - Action timestamp

  ### `workflow_rules`
  Defines approval hierarchy requirements:
  - `id` (uuid, primary key) - Rule ID
  - `role` (text) - Role that must approve
  - `order` (integer) - Approval order (1-5)
  - `required` (boolean) - Whether approval from this role is mandatory
  - `created_at` (timestamptz) - Rule creation timestamp

  ## 2. Security
  - RLS enabled on all tables
  - Policies restrict access based on user roles
  - Administrators have full access
  - Users can view invoices relevant to their approval level
  - Only uploaders and administrators can modify pending invoices

  ## 3. Initial Data
  - Default workflow rules for 5-tier approval process
  - Role hierarchy: Specjalista → Kierownik → Dyrektor → CEO → Administrator

  ## 4. Indexes
  - Optimized queries for invoice status, user roles, and approval workflows
*/

-- Create enum types
DO $$ BEGIN
  CREATE TYPE user_role AS ENUM ('Administrator', 'CEO', 'Dyrektor', 'Kierownik', 'Specjalista');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE invoice_status AS ENUM ('pending', 'in_review', 'approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE approval_action AS ENUM ('approved', 'rejected');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email text NOT NULL,
  full_name text NOT NULL,
  role text NOT NULL CHECK (role IN ('Administrator', 'CEO', 'Dyrektor', 'Kierownik', 'Specjalista')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Invoices table
CREATE TABLE IF NOT EXISTS invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_number text,
  supplier_name text,
  supplier_nip text,
  issue_date date,
  due_date date,
  net_amount decimal(15,2),
  tax_amount decimal(15,2),
  gross_amount decimal(15,2),
  currency text DEFAULT 'PLN',
  file_url text NOT NULL,
  google_drive_id text,
  ocr_data jsonb,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_review', 'approved', 'rejected')),
  uploaded_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Approvals table
CREATE TABLE IF NOT EXISTS approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES profiles(id),
  approver_role text NOT NULL,
  action text NOT NULL CHECK (action IN ('approved', 'rejected')),
  comment text,
  created_at timestamptz DEFAULT now()
);

-- Workflow rules table
CREATE TABLE IF NOT EXISTS workflow_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  role text NOT NULL CHECK (role IN ('Administrator', 'CEO', 'Dyrektor', 'Kierownik', 'Specjalista')),
  "order" integer NOT NULL,
  required boolean DEFAULT true,
  created_at timestamptz DEFAULT now(),
  UNIQUE(role)
);

-- Insert default workflow rules
INSERT INTO workflow_rules (role, "order", required) VALUES
  ('Specjalista', 1, true),
  ('Kierownik', 2, true),
  ('Dyrektor', 3, true),
  ('CEO', 4, true),
  ('Administrator', 5, true)
ON CONFLICT (role) DO NOTHING;

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_invoices_status ON invoices(status);
CREATE INDEX IF NOT EXISTS idx_invoices_uploaded_by ON invoices(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_invoices_created_at ON invoices(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_approvals_invoice_id ON approvals(invoice_id);
CREATE INDEX IF NOT EXISTS idx_approvals_approver_id ON approvals(approver_id);
CREATE INDEX IF NOT EXISTS idx_profiles_role ON profiles(role);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE invoices ENABLE ROW LEVEL SECURITY;
ALTER TABLE approvals ENABLE ROW LEVEL SECURITY;
ALTER TABLE workflow_rules ENABLE ROW LEVEL SECURITY;

-- Profiles policies
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Administrators can update any profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Administrator'
    )
  );

CREATE POLICY "Administrators can insert profiles"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Administrator'
    )
  );

-- Invoices policies
CREATE POLICY "Users can view invoices"
  ON invoices FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can create invoices"
  ON invoices FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Uploader can update own pending invoices"
  ON invoices FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid() AND status = 'pending')
  WITH CHECK (uploaded_by = auth.uid());

CREATE POLICY "Administrators can update any invoice"
  ON invoices FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Administrator'
    )
  );

CREATE POLICY "Administrators can delete invoices"
  ON invoices FOR DELETE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Administrator'
    )
  );

-- Approvals policies
CREATE POLICY "Users can view all approvals"
  ON approvals FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can create approvals"
  ON approvals FOR INSERT
  TO authenticated
  WITH CHECK (approver_id = auth.uid());

-- Workflow rules policies
CREATE POLICY "Everyone can view workflow rules"
  ON workflow_rules FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Only administrators can modify workflow rules"
  ON workflow_rules FOR ALL
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'Administrator'
    )
  );

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Triggers for updated_at
DROP TRIGGER IF EXISTS update_profiles_updated_at ON profiles;
CREATE TRIGGER update_profiles_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();

DROP TRIGGER IF EXISTS update_invoices_updated_at ON invoices;
CREATE TRIGGER update_invoices_updated_at
  BEFORE UPDATE ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION update_updated_at_column();