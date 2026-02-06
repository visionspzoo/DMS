/*
  # Create KSEF Invoices Table
  
  1. New Tables
    - `ksef_invoices`
      - `id` (uuid, primary key) - Internal ID
      - `ksef_reference_number` (text, unique) - KSeF reference number from API
      - `invoice_number` (text) - Invoice number
      - `supplier_name` (text) - Supplier/seller name
      - `supplier_nip` (text) - Supplier tax ID (NIP)
      - `buyer_name` (text) - Buyer name
      - `buyer_nip` (text) - Buyer tax ID (NIP)
      - `issue_date` (date) - Invoice issue date
      - `net_amount` (numeric) - Net amount
      - `gross_amount` (numeric) - Gross amount (total)
      - `currency` (text) - Currency code (PLN, EUR, etc.)
      - `invoice_xml` (text) - Full invoice XML from KSeF
      - `fetched_by` (uuid) - User who fetched this invoice
      - `transferred_to_invoice_id` (uuid, nullable) - Reference to invoice if transferred
      - `transferred_at` (timestamptz, nullable) - When was it transferred
      - `created_at` (timestamptz) - When was it fetched
      
  2. Security
    - Enable RLS on `ksef_invoices` table
    - Add policy for authenticated users to view KSEF invoices for their organization
    - Add policy for users to transfer invoices to their system
    - Add policy for users to fetch new invoices from KSEF
    
  3. Indexes
    - Index on ksef_reference_number for fast lookups
    - Index on fetched_by for filtering
    - Index on transferred_to_invoice_id for checking transfers
*/

-- Create KSEF invoices table
CREATE TABLE IF NOT EXISTS ksef_invoices (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  ksef_reference_number text UNIQUE NOT NULL,
  invoice_number text NOT NULL,
  supplier_name text,
  supplier_nip text,
  buyer_name text,
  buyer_nip text,
  issue_date date,
  net_amount numeric(12, 2) DEFAULT 0,
  gross_amount numeric(12, 2) DEFAULT 0,
  currency text DEFAULT 'PLN',
  invoice_xml text,
  fetched_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  transferred_to_invoice_id uuid REFERENCES invoices(id) ON DELETE SET NULL,
  transferred_at timestamptz,
  created_at timestamptz DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_reference ON ksef_invoices(ksef_reference_number);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_fetched_by ON ksef_invoices(fetched_by);
CREATE INDEX IF NOT EXISTS idx_ksef_invoices_transferred ON ksef_invoices(transferred_to_invoice_id);

-- Enable RLS
ALTER TABLE ksef_invoices ENABLE ROW LEVEL SECURITY;

-- Policy: Authenticated users can view all KSEF invoices (for their organization)
CREATE POLICY "Authenticated users can view KSEF invoices"
  ON ksef_invoices FOR SELECT
  TO authenticated
  USING (true);

-- Policy: Authenticated users can insert KSEF invoices (when fetching)
CREATE POLICY "Authenticated users can insert KSEF invoices"
  ON ksef_invoices FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = fetched_by);

-- Policy: Authenticated users can update KSEF invoices they fetched (for transfer)
CREATE POLICY "Users can update KSEF invoices for transfer"
  ON ksef_invoices FOR UPDATE
  TO authenticated
  USING (auth.uid() = fetched_by)
  WITH CHECK (auth.uid() = fetched_by);

-- Policy: Users can delete KSEF invoices they fetched
CREATE POLICY "Users can delete KSEF invoices they fetched"
  ON ksef_invoices FOR DELETE
  TO authenticated
  USING (auth.uid() = fetched_by);
