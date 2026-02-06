/*
  # Add Contract Comments System

  1. New Tables
    - `contract_comments`
      - `id` (uuid, primary key)
      - `contract_id` (uuid, foreign key to contracts)
      - `user_id` (uuid, foreign key to auth.users)
      - `comment` (text, the comment content)
      - `created_at` (timestamp)
      - `updated_at` (timestamp)
  
  2. Security
    - Enable RLS on contract_comments table
    - Users can read all comments for contracts they have access to
    - Users can create their own comments
    - Users can update/delete only their own comments
*/

-- Create contract_comments table
CREATE TABLE IF NOT EXISTS contract_comments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  comment text NOT NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- Enable RLS
ALTER TABLE contract_comments ENABLE ROW LEVEL SECURITY;

-- Users can read comments for contracts they can see
CREATE POLICY "Users can read comments for accessible contracts"
  ON contract_comments
  FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM contracts
      WHERE contracts.id = contract_comments.contract_id
    )
  );

-- Users can create comments
CREATE POLICY "Users can create comments"
  ON contract_comments
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

-- Users can update their own comments
CREATE POLICY "Users can update own comments"
  ON contract_comments
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

-- Users can delete their own comments
CREATE POLICY "Users can delete own comments"
  ON contract_comments
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);

-- Create index for faster queries
CREATE INDEX IF NOT EXISTS idx_contract_comments_contract_id 
  ON contract_comments(contract_id);

CREATE INDEX IF NOT EXISTS idx_contract_comments_created_at 
  ON contract_comments(created_at DESC);
