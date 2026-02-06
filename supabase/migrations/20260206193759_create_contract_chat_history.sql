/*
  # Create contract chat history table

  1. New Tables
    - `contract_chat_messages`
      - `id` (uuid, primary key)
      - `contract_id` (uuid, references contracts)
      - `user_id` (uuid, references auth.users)
      - `role` (text: user or assistant)
      - `content` (text, message content)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `contract_chat_messages`
    - Users can only read/write their own chat messages

  3. Indexes
    - Index on (contract_id, user_id, created_at) for fast lookups
*/

CREATE TABLE IF NOT EXISTS contract_chat_messages (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  contract_id uuid NOT NULL REFERENCES contracts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE contract_chat_messages ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_contract_chat_messages_lookup
  ON contract_chat_messages (contract_id, user_id, created_at);

CREATE POLICY "Users can read own contract chat messages"
  ON contract_chat_messages
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own contract chat messages"
  ON contract_chat_messages
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own contract chat messages"
  ON contract_chat_messages
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
