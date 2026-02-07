/*
  # Add preferred LLM model to profiles

  1. Modified Tables
    - `profiles`
      - `preferred_llm_model` (text, default 'claude-sonnet-4') - stores user's preferred AI model
        Supported values: 'claude-sonnet-4', 'gpt-4o', 'gemini-2.0-flash'

  2. Notes
    - Default is Claude Sonnet 4 (current model)
    - Users can change their preference in the AI Agent interface
    - Preference is used across all AI features (chat, contract analysis, ML predictions)
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'profiles' AND column_name = 'preferred_llm_model'
  ) THEN
    ALTER TABLE profiles ADD COLUMN preferred_llm_model text NOT NULL DEFAULT 'claude-sonnet-4';
  END IF;
END $$;
