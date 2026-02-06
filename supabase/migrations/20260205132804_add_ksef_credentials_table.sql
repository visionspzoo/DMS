/*
  # Create KSEF Credentials Table
  
  1. New Tables
    - `ksef_credentials`
      - `id` (uuid, primary key) - Internal ID
      - `user_id` (uuid, foreign key) - Reference to user/profile
      - `token` (text) - KSEF API token (encrypted)
      - `nip` (text) - Company NIP number
      - `environment` (text) - Environment (demo, test, prod)
      - `created_at` (timestamptz) - When credentials were added
      - `updated_at` (timestamptz) - When credentials were last updated
      
  2. Security
    - Enable RLS on `ksef_credentials` table
    - Add policy for users to view their own credentials
    - Add policy for users to insert their own credentials
    - Add policy for users to update their own credentials
    - Add policy for users to delete their own credentials
    
  3. Constraints
    - One set of credentials per user (unique on user_id)
*/

-- Create KSEF credentials table
CREATE TABLE IF NOT EXISTS ksef_credentials (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  token text NOT NULL,
  nip text NOT NULL,
  environment text DEFAULT 'demo' CHECK (environment IN ('demo', 'test', 'prod')),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Create index on user_id for fast lookups
CREATE INDEX IF NOT EXISTS idx_ksef_credentials_user_id ON ksef_credentials(user_id);

-- Enable RLS
ALTER TABLE ksef_credentials ENABLE ROW LEVEL SECURITY;

-- Policy: Users can view their own credentials
CREATE POLICY "Users can view own KSEF credentials"
  ON ksef_credentials FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

-- Policy: Users can insert their own credentials
CREATE POLICY "Users can insert own KSEF credentials"
  ON ksef_credentials FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can update their own credentials
CREATE POLICY "Users can update own KSEF credentials"
  ON ksef_credentials FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Policy: Users can delete their own credentials
CREATE POLICY "Users can delete own KSEF credentials"
  ON ksef_credentials FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Function to update updated_at timestamp
CREATE OR REPLACE FUNCTION update_ksef_credentials_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Trigger to automatically update updated_at
CREATE TRIGGER update_ksef_credentials_updated_at
  BEFORE UPDATE ON ksef_credentials
  FOR EACH ROW
  EXECUTE FUNCTION update_ksef_credentials_updated_at();
