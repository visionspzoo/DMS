/*
  # Add Auto-Learning System for Tags

  1. New Tables
    - `tag_learning`
      - `id` (uuid, primary key)
      - `vendor_name` (text) - normalized vendor name
      - `description_keywords` (text[]) - array of keywords from description
      - `tag_id` (uuid) - reference to tags table
      - `frequency` (integer) - how many times this mapping was used
      - `last_used` (timestamptz)
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on tag_learning
    - All authenticated users can read for suggestions
    - System updates learning data automatically

  3. Functions
    - Trigger to update tag learning when invoice_tags are added
*/

-- Create tag_learning table for auto-suggestions
CREATE TABLE IF NOT EXISTS tag_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name text NOT NULL,
  description_keywords text[],
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  frequency integer DEFAULT 1,
  last_used timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(vendor_name, tag_id)
);

-- Create indexes for tag learning
CREATE INDEX IF NOT EXISTS idx_tag_learning_vendor ON tag_learning(vendor_name);
CREATE INDEX IF NOT EXISTS idx_tag_learning_keywords ON tag_learning USING gin(description_keywords);
CREATE INDEX IF NOT EXISTS idx_tag_learning_tag_id ON tag_learning(tag_id);

-- Enable RLS
ALTER TABLE tag_learning ENABLE ROW LEVEL SECURITY;

-- All authenticated users can read tag learning data for suggestions
CREATE POLICY "Authenticated users can view tag learning"
  ON tag_learning
  FOR SELECT
  TO authenticated
  USING (true);

-- Function to update tag learning when tags are added to invoices
CREATE OR REPLACE FUNCTION update_tag_learning_from_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_vendor_name text;
  v_description text;
  v_keywords text[];
BEGIN
  -- Get invoice details
  SELECT supplier_name, description
  INTO v_vendor_name, v_description
  FROM invoices
  WHERE id = NEW.invoice_id;

  -- Normalize vendor name
  v_vendor_name := TRIM(v_vendor_name);

  -- Extract keywords from description (split by spaces, filter short words)
  IF v_description IS NOT NULL AND LENGTH(v_description) > 0 THEN
    SELECT ARRAY_AGG(DISTINCT keyword)
    INTO v_keywords
    FROM (
      SELECT LOWER(word) as keyword
      FROM regexp_split_to_table(v_description, '\s+') as word
      WHERE LENGTH(word) > 3
      LIMIT 10
    ) keywords;
  END IF;

  -- Update or insert into tag_learning
  INSERT INTO tag_learning (vendor_name, description_keywords, tag_id, frequency, last_used)
  VALUES (v_vendor_name, v_keywords, NEW.tag_id, 1, now())
  ON CONFLICT (vendor_name, tag_id)
  DO UPDATE SET
    frequency = tag_learning.frequency + 1,
    last_used = now(),
    description_keywords = CASE 
      WHEN EXCLUDED.description_keywords IS NOT NULL 
      THEN EXCLUDED.description_keywords 
      ELSE tag_learning.description_keywords 
    END;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

-- Create trigger to update learning when tags are added
DROP TRIGGER IF EXISTS trigger_update_tag_learning ON invoice_tags;
CREATE TRIGGER trigger_update_tag_learning
  AFTER INSERT ON invoice_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_tag_learning_from_invoice();
