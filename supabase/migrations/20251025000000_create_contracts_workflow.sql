/*
  # Create Contracts Workflow System

  1. New Tables
    - `contracts`
      - `id` (uuid, primary key)
      - `contract_number` (text) - unique contract identifier
      - `title` (text) - contract title/subject
      - `description` (text) - contract description
      - `file_url` (text) - PDF file URL in storage
      - `pdf_base64` (text) - base64 encoded PDF for processing
      - `uploaded_by` (uuid) - reference to auth.users
      - `department_id` (uuid) - reference to departments
      - `status` (text) - workflow status: draft, pending_manager, pending_director, pending_ceo, approved, rejected
      - `current_approver` (uuid) - current person who needs to approve
      - `google_doc_id` (text) - Google Docs ID for signing
      - `signed_url` (text) - URL to signed document
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `contract_approvals`
      - `id` (uuid, primary key)
      - `contract_id` (uuid) - reference to contracts
      - `approver_id` (uuid) - reference to auth.users
      - `approver_role` (text) - manager, director, ceo
      - `status` (text) - pending, approved, rejected
      - `comment` (text) - optional approval comment
      - `approved_at` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Users can view contracts from their department
    - Managers can approve contracts in their department
    - Directors can approve all contracts
    - CEO can approve and sign all contracts
    - Uploaders can delete draft contracts

  3. Workflow
    - Manager → Director → CEO → Signed
    - Each step requires approval before moving to next
    - CEO signs using Google Docs API
*/

-- Create contracts table
CREATE TABLE IF NOT EXISTS contracts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_number text UNIQUE,
  title text NOT NULL,
  description text,
  file_url text NOT NULL,
  pdf_base64 text,
  uploaded_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  department_id uuid REFERENCES departments(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'pending_manager' CHECK (status IN ('draft', 'pending_manager', 'pending_director', 'pending_ceo', 'approved', 'rejected')),
  current_approver uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  google_doc_id text,
  signed_url text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create contract_approvals table
CREATE TABLE IF NOT EXISTS contract_approvals (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  approver_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  approver_role text NOT NULL CHECK (approver_role IN ('manager', 'director', 'ceo')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  comment text,
  approved_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_contracts_status ON contracts(status);
CREATE INDEX IF NOT EXISTS idx_contracts_department ON contracts(department_id);
CREATE INDEX IF NOT EXISTS idx_contracts_uploaded_by ON contracts(uploaded_by);
CREATE INDEX IF NOT EXISTS idx_contracts_current_approver ON contracts(current_approver);
CREATE INDEX IF NOT EXISTS idx_contract_approvals_contract ON contract_approvals(contract_id);
CREATE INDEX IF NOT EXISTS idx_contract_approvals_approver ON contract_approvals(approver_id);

-- Enable RLS
ALTER TABLE contracts ENABLE ROW LEVEL SECURITY;
ALTER TABLE contract_approvals ENABLE ROW LEVEL SECURITY;

-- Contracts policies

-- Users can view contracts from their department or if they uploaded them
CREATE POLICY "Users can view department contracts"
  ON contracts
  FOR SELECT
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR department_id IN (
      SELECT department_id FROM department_members WHERE user_id = auth.uid()
    )
    OR EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dyrektor', 'ceo')
    )
  );

-- Users can insert contracts
CREATE POLICY "Users can create contracts"
  ON contracts
  FOR INSERT
  TO authenticated
  WITH CHECK (uploaded_by = auth.uid());

-- Users can update their own draft contracts
CREATE POLICY "Users can update own draft contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (uploaded_by = auth.uid() AND status = 'draft')
  WITH CHECK (uploaded_by = auth.uid() AND status = 'draft');

-- Users can delete their own draft contracts
CREATE POLICY "Users can delete own draft contracts"
  ON contracts
  FOR DELETE
  TO authenticated
  USING (uploaded_by = auth.uid() AND status = 'draft');

-- Managers can approve contracts in their department
CREATE POLICY "Managers can approve department contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    status = 'pending_manager'
    AND department_id IN (
      SELECT id FROM departments WHERE manager_id = auth.uid()
    )
  )
  WITH CHECK (
    status IN ('pending_director', 'rejected')
  );

-- Directors can approve all contracts
CREATE POLICY "Directors can approve contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    status = 'pending_director'
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'dyrektor')
  )
  WITH CHECK (
    status IN ('pending_ceo', 'rejected')
  );

-- CEO can approve and sign contracts
CREATE POLICY "CEO can approve and sign contracts"
  ON contracts
  FOR UPDATE
  TO authenticated
  USING (
    status IN ('pending_ceo', 'approved')
    AND EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'ceo')
  )
  WITH CHECK (
    status IN ('approved', 'rejected')
  );

-- Contract approvals policies

-- Users can view approvals for contracts they can see
CREATE POLICY "Users can view contract approvals"
  ON contract_approvals
  FOR SELECT
  TO authenticated
  USING (
    contract_id IN (
      SELECT id FROM contracts
      WHERE uploaded_by = auth.uid()
        OR department_id IN (
          SELECT department_id FROM department_members WHERE user_id = auth.uid()
        )
        OR EXISTS (
          SELECT 1 FROM profiles WHERE id = auth.uid() AND role IN ('dyrektor', 'ceo')
        )
    )
  );

-- System can insert approvals (will be done via triggers)
CREATE POLICY "System can create approvals"
  ON contract_approvals
  FOR INSERT
  TO authenticated
  WITH CHECK (true);

-- Approvers can update their own pending approvals
CREATE POLICY "Approvers can update own approvals"
  ON contract_approvals
  FOR UPDATE
  TO authenticated
  USING (approver_id = auth.uid() AND status = 'pending')
  WITH CHECK (approver_id = auth.uid() AND status IN ('approved', 'rejected'));

-- Function to generate contract number
CREATE OR REPLACE FUNCTION generate_contract_number()
RETURNS text AS $$
DECLARE
  current_year text;
  next_number integer;
  contract_number text;
BEGIN
  current_year := TO_CHAR(CURRENT_DATE, 'YYYY');

  SELECT COALESCE(MAX(CAST(SUBSTRING(contract_number FROM '\d+$') AS integer)), 0) + 1
  INTO next_number
  FROM contracts
  WHERE contract_number LIKE 'UMW/' || current_year || '/%';

  contract_number := 'UMW/' || current_year || '/' || LPAD(next_number::text, 4, '0');

  RETURN contract_number;
END;
$$ LANGUAGE plpgsql;

-- Trigger to auto-generate contract number
CREATE OR REPLACE FUNCTION set_contract_number()
RETURNS TRIGGER AS $$
BEGIN
  IF NEW.contract_number IS NULL THEN
    NEW.contract_number := generate_contract_number();
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_set_contract_number ON contracts;
CREATE TRIGGER trigger_set_contract_number
  BEFORE INSERT ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION set_contract_number();

-- Function to create approval workflow when contract is created
CREATE OR REPLACE FUNCTION create_contract_approval_workflow()
RETURNS TRIGGER AS $$
DECLARE
  v_manager_id uuid;
  v_director_id uuid;
  v_ceo_id uuid;
BEGIN
  -- Get manager from department
  SELECT manager_id INTO v_manager_id
  FROM departments
  WHERE id = NEW.department_id;

  -- Get director
  SELECT id INTO v_director_id
  FROM profiles
  WHERE role = 'dyrektor'
  LIMIT 1;

  -- Get CEO
  SELECT id INTO v_ceo_id
  FROM profiles
  WHERE role = 'ceo'
  LIMIT 1;

  -- Create manager approval
  IF v_manager_id IS NOT NULL THEN
    INSERT INTO contract_approvals (contract_id, approver_id, approver_role, status)
    VALUES (NEW.id, v_manager_id, 'manager', 'pending');

    -- Set current approver to manager
    UPDATE contracts SET current_approver = v_manager_id WHERE id = NEW.id;
  END IF;

  -- Create director approval (pending until manager approves)
  IF v_director_id IS NOT NULL THEN
    INSERT INTO contract_approvals (contract_id, approver_id, approver_role, status)
    VALUES (NEW.id, v_director_id, 'director', 'pending');
  END IF;

  -- Create CEO approval (pending until director approves)
  IF v_ceo_id IS NOT NULL THEN
    INSERT INTO contract_approvals (contract_id, approver_id, approver_role, status)
    VALUES (NEW.id, v_ceo_id, 'ceo', 'pending');
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_create_contract_workflow ON contracts;
CREATE TRIGGER trigger_create_contract_workflow
  AFTER INSERT ON contracts
  FOR EACH ROW
  WHEN (NEW.status != 'draft')
  EXECUTE FUNCTION create_contract_approval_workflow();

-- Function to update contract updated_at timestamp
CREATE OR REPLACE FUNCTION update_contract_timestamp()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trigger_update_contract_timestamp ON contracts;
CREATE TRIGGER trigger_update_contract_timestamp
  BEFORE UPDATE ON contracts
  FOR EACH ROW
  EXECUTE FUNCTION update_contract_timestamp();
