/*
  # Create purchase_requests table

  ## New Tables
  - `purchase_requests` - stores purchase request forms submitted by users

  ## Columns
  - id (uuid, primary key)
  - user_id (uuid, FK to auth.users) - who submitted
  - link (text) - link to product/purchase
  - gross_amount (numeric) - gross price
  - description (text) - description of item
  - quantity (integer) - number of units
  - delivery_location (text) - one of: Botaniczna, Budowlanych, Lęborska
  - priority (text) - one of: niski, normalny, wysoki, pilny
  - status (text) - pending, approved, rejected
  - created_at (timestamptz)
  - updated_at (timestamptz)

  ## Security
  - RLS enabled
  - Users can insert their own requests
  - Users can view their own requests
  - Admins can view and update all requests
*/

CREATE TABLE IF NOT EXISTS purchase_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  link text NOT NULL DEFAULT '',
  gross_amount numeric(12, 2) NOT NULL DEFAULT 0,
  description text NOT NULL DEFAULT '',
  quantity integer NOT NULL DEFAULT 1,
  delivery_location text NOT NULL DEFAULT 'Botaniczna',
  priority text NOT NULL DEFAULT 'normalny',
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE purchase_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can insert own purchase requests"
  ON purchase_requests FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can view own purchase requests"
  ON purchase_requests FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Admins can view all purchase requests"
  ON purchase_requests FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE POLICY "Admins can update any purchase request"
  ON purchase_requests FOR UPDATE
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true
    )
  );

CREATE INDEX IF NOT EXISTS idx_purchase_requests_user_id ON purchase_requests(user_id);
CREATE INDEX IF NOT EXISTS idx_purchase_requests_created_at ON purchase_requests(created_at DESC);
