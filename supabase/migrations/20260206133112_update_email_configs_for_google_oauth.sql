/*
  # Update Email Configs for Google OAuth Only

  1. Changes
    - Add oauth_access_token column for storing Google OAuth tokens
    - Add oauth_refresh_token column for token refresh
    - Add oauth_token_expiry column to track token expiration
    - Make imap_server, imap_port, email_username, email_password nullable (backwards compatibility)
    - Update provider to default to 'google_workspace'
    - Add constraint to only allow google_workspace provider
  
  2. Security
    - Tokens are stored securely and only accessible to the user
    - RLS policies remain unchanged
  
  3. Purpose
    - Transition from IMAP authentication to OAuth for Google Workspace
    - Remove support for other email providers
*/

-- Add OAuth columns
ALTER TABLE user_email_configs 
  ADD COLUMN IF NOT EXISTS oauth_access_token text,
  ADD COLUMN IF NOT EXISTS oauth_refresh_token text,
  ADD COLUMN IF NOT EXISTS oauth_token_expiry timestamptz;

-- Make IMAP fields nullable for backwards compatibility
ALTER TABLE user_email_configs 
  ALTER COLUMN imap_server DROP NOT NULL,
  ALTER COLUMN imap_port DROP NOT NULL,
  ALTER COLUMN email_username DROP NOT NULL,
  ALTER COLUMN email_password DROP NOT NULL;

-- Update provider default
ALTER TABLE user_email_configs 
  ALTER COLUMN provider SET DEFAULT 'google_workspace';

-- Add check constraint to only allow google_workspace
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint 
    WHERE conname = 'user_email_configs_provider_check'
  ) THEN
    ALTER TABLE user_email_configs 
      ADD CONSTRAINT user_email_configs_provider_check 
      CHECK (provider = 'google_workspace');
  END IF;
END $$;