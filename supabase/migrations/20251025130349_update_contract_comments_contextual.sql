/*
  # Update Contract Comments for Contextual Annotations

  1. Changes to contract_comments
    - Add `highlighted_text` (text) - the text that was highlighted
    - Add `position_data` (jsonb) - stores position info (page, coordinates, etc)
    - Add `comment_type` (text) - 'general' or 'contextual'
    - Make `highlighted_text` and `position_data` nullable for backward compatibility
  
  2. Notes
    - Existing comments will be type 'general'
    - New contextual comments will have highlighted text and position
*/

-- Add new columns to contract_comments
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_comments' AND column_name = 'highlighted_text'
  ) THEN
    ALTER TABLE contract_comments ADD COLUMN highlighted_text text;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_comments' AND column_name = 'position_data'
  ) THEN
    ALTER TABLE contract_comments ADD COLUMN position_data jsonb;
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns 
    WHERE table_name = 'contract_comments' AND column_name = 'comment_type'
  ) THEN
    ALTER TABLE contract_comments ADD COLUMN comment_type text DEFAULT 'general' CHECK (comment_type IN ('general', 'contextual'));
  END IF;
END $$;

-- Create index for faster queries by type
CREATE INDEX IF NOT EXISTS idx_contract_comments_type 
  ON contract_comments(comment_type);
