/*
  # Create contract AI prompts table

  1. New Tables
    - `contract_ai_prompts`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users)
      - `name` (text) - display name for the prompt
      - `prompt_text` (text) - the actual prompt content
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `contract_ai_prompts` table
    - Users can only manage their own prompts
*/

CREATE TABLE IF NOT EXISTS contract_ai_prompts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id),
  name text NOT NULL,
  prompt_text text NOT NULL,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE contract_ai_prompts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own prompts"
  ON contract_ai_prompts
  FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can insert own prompts"
  ON contract_ai_prompts
  FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own prompts"
  ON contract_ai_prompts
  FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own prompts"
  ON contract_ai_prompts
  FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
