/*
  # Create API tokens table for external integrations (Alice)

  1. New Tables
    - `api_tokens`
      - `id` (uuid, primary key)
      - `user_id` (uuid, FK to auth.users) - owner of the token
      - `token_hash` (text, unique) - SHA-256 hash of the token (never store plaintext)
      - `token_prefix` (text) - first 8 chars for display (e.g. "aurs_abc1...")
      - `name` (text) - user-given label, e.g. "Alice desktop"
      - `is_active` (boolean, default true) - can be deactivated without deleting
      - `last_used_at` (timestamptz) - tracks last API call
      - `expires_at` (timestamptz) - optional expiry
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on `api_tokens`
    - Users can only manage their own tokens
    - Token hash is stored, never the raw token

  3. Notes
    - Tokens are generated client-side, hashed, and only the hash is stored
    - The raw token is shown once at creation and never again
    - External apps (Alice) use the token to call the alice-api edge function
*/

CREATE TABLE IF NOT EXISTS api_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  token_hash text UNIQUE NOT NULL,
  token_prefix text NOT NULL,
  name text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  last_used_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_api_tokens_user_id ON api_tokens(user_id);
CREATE INDEX IF NOT EXISTS idx_api_tokens_token_hash ON api_tokens(token_hash);

ALTER TABLE api_tokens ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own tokens"
  ON api_tokens FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id);

CREATE POLICY "Users can create own tokens"
  ON api_tokens FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can update own tokens"
  ON api_tokens FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id)
  WITH CHECK (auth.uid() = user_id);

CREATE POLICY "Users can delete own tokens"
  ON api_tokens FOR DELETE
  TO authenticated
  USING (auth.uid() = user_id);
