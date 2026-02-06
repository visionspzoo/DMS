/*
  # Create ML-Powered Invoice Tagging System

  1. New Tables
    - `tags` - Tag definitions with name and color
      - `id` (uuid, primary key)
      - `name` (text, unique) - tag display name
      - `color` (text) - hex color code

    - `invoice_tags` - Junction table linking invoices to tags
      - `id` (uuid, primary key)
      - `invoice_id` (uuid) - FK to invoices
      - `tag_id` (uuid) - FK to tags

    - `tag_learning` - Historical patterns for ML predictions
      - `vendor_name` (text) - normalized vendor name
      - `supplier_nip` (text) - vendor NIP for reliable matching
      - `tag_id` (uuid) - which tag was applied
      - `frequency` (integer) - how many times this mapping was used
      - `description_keywords` (text[]) - extracted keywords
      - `department_id` (uuid) - department context
      - `amount_bucket` (text) - amount range category

    - `ml_tag_predictions` - AI-generated tag predictions cache
      - `invoice_id` (uuid) - invoice being predicted for
      - `tag_id` (uuid) - predicted tag
      - `confidence` (numeric) - 0.0 to 1.0 score
      - `source` (text) - prediction method
      - `reasoning` (text) - explanation in Polish
      - `applied` / `dismissed` (boolean) - user feedback

  2. Functions
    - Auto-learn trigger on tag addition (captures vendor, NIP, amount, dept)
    - Decrement trigger on tag removal (negative feedback)
    - Both triggers update ml_tag_predictions status

  3. Security
    - RLS on all tables
    - Tags readable by all authenticated users
    - Invoice tags managed by users who can access the invoice
    - ML predictions tied to invoice access
*/

-- Tags table
CREATE TABLE IF NOT EXISTS tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  color text NOT NULL DEFAULT '#3B82F6',
  created_at timestamptz DEFAULT now()
);

ALTER TABLE tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tags"
  ON tags FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can create tags"
  ON tags FOR INSERT TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Invoice-tag junction table
CREATE TABLE IF NOT EXISTS invoice_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(invoice_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_invoice_tags_invoice ON invoice_tags(invoice_id);
CREATE INDEX IF NOT EXISTS idx_invoice_tags_tag ON invoice_tags(tag_id);

ALTER TABLE invoice_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view invoice tags for accessible invoices"
  ON invoice_tags FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_tags.invoice_id)
  );

CREATE POLICY "Users can add tags to accessible invoices"
  ON invoice_tags FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_tags.invoice_id)
  );

CREATE POLICY "Users can remove tags from accessible invoices"
  ON invoice_tags FOR DELETE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = invoice_tags.invoice_id)
  );

-- Tag learning table for ML pattern storage
CREATE TABLE IF NOT EXISTS tag_learning (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  vendor_name text NOT NULL,
  supplier_nip text,
  description_keywords text[],
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  department_id uuid,
  amount_bucket text,
  frequency integer DEFAULT 1,
  last_used timestamptz DEFAULT now(),
  created_at timestamptz DEFAULT now(),
  UNIQUE(vendor_name, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_tag_learning_vendor ON tag_learning(vendor_name);
CREATE INDEX IF NOT EXISTS idx_tag_learning_nip ON tag_learning(supplier_nip);
CREATE INDEX IF NOT EXISTS idx_tag_learning_keywords ON tag_learning USING gin(description_keywords);
CREATE INDEX IF NOT EXISTS idx_tag_learning_tag_id ON tag_learning(tag_id);

ALTER TABLE tag_learning ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view tag learning data"
  ON tag_learning FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- ML predictions cache table
CREATE TABLE IF NOT EXISTS ml_tag_predictions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id uuid NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  confidence numeric NOT NULL DEFAULT 0,
  source text NOT NULL DEFAULT 'ml_claude',
  reasoning text,
  applied boolean DEFAULT false,
  dismissed boolean DEFAULT false,
  created_at timestamptz DEFAULT now(),
  UNIQUE(invoice_id, tag_id)
);

CREATE INDEX IF NOT EXISTS idx_ml_predictions_invoice ON ml_tag_predictions(invoice_id);

ALTER TABLE ml_tag_predictions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view predictions for accessible invoices"
  ON ml_tag_predictions FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = ml_tag_predictions.invoice_id)
  );

CREATE POLICY "Users can update predictions for accessible invoices"
  ON ml_tag_predictions FOR UPDATE TO authenticated
  USING (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = ml_tag_predictions.invoice_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM invoices WHERE invoices.id = ml_tag_predictions.invoice_id)
  );

-- Auto-learn trigger: captures rich data when tags are assigned
CREATE OR REPLACE FUNCTION update_tag_learning_from_invoice()
RETURNS TRIGGER AS $$
DECLARE
  v_vendor_name text;
  v_supplier_nip text;
  v_description text;
  v_department_id uuid;
  v_gross_amount numeric;
  v_keywords text[];
  v_amount_bucket text;
BEGIN
  SELECT supplier_name, supplier_nip, description, department_id, gross_amount
  INTO v_vendor_name, v_supplier_nip, v_description, v_department_id, v_gross_amount
  FROM invoices
  WHERE id = NEW.invoice_id;

  v_vendor_name := TRIM(COALESCE(v_vendor_name, ''));

  IF v_gross_amount IS NULL OR v_gross_amount <= 0 THEN
    v_amount_bucket := 'unknown';
  ELSIF v_gross_amount < 1000 THEN
    v_amount_bucket := 'small';
  ELSIF v_gross_amount < 10000 THEN
    v_amount_bucket := 'medium';
  ELSIF v_gross_amount < 100000 THEN
    v_amount_bucket := 'large';
  ELSE
    v_amount_bucket := 'very_large';
  END IF;

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

  INSERT INTO tag_learning (vendor_name, supplier_nip, description_keywords, tag_id, department_id, amount_bucket, frequency, last_used)
  VALUES (v_vendor_name, v_supplier_nip, v_keywords, NEW.tag_id, v_department_id, v_amount_bucket, 1, now())
  ON CONFLICT (vendor_name, tag_id)
  DO UPDATE SET
    frequency = tag_learning.frequency + 1,
    last_used = now(),
    supplier_nip = COALESCE(EXCLUDED.supplier_nip, tag_learning.supplier_nip),
    department_id = COALESCE(EXCLUDED.department_id, tag_learning.department_id),
    amount_bucket = COALESCE(EXCLUDED.amount_bucket, tag_learning.amount_bucket),
    description_keywords = CASE
      WHEN EXCLUDED.description_keywords IS NOT NULL
      THEN EXCLUDED.description_keywords
      ELSE tag_learning.description_keywords
    END;

  UPDATE ml_tag_predictions
  SET applied = true
  WHERE invoice_id = NEW.invoice_id AND tag_id = NEW.tag_id;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_update_tag_learning ON invoice_tags;
CREATE TRIGGER trigger_update_tag_learning
  AFTER INSERT ON invoice_tags
  FOR EACH ROW
  EXECUTE FUNCTION update_tag_learning_from_invoice();

-- Decrement learning on tag removal (negative feedback)
CREATE OR REPLACE FUNCTION decrement_tag_learning_on_removal()
RETURNS TRIGGER AS $$
DECLARE
  v_vendor_name text;
BEGIN
  SELECT TRIM(COALESCE(supplier_name, ''))
  INTO v_vendor_name
  FROM invoices
  WHERE id = OLD.invoice_id;

  IF v_vendor_name != '' THEN
    UPDATE tag_learning
    SET frequency = GREATEST(frequency - 1, 0),
        last_used = now()
    WHERE vendor_name = v_vendor_name AND tag_id = OLD.tag_id;
  END IF;

  RETURN OLD;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trigger_decrement_tag_learning ON invoice_tags;
CREATE TRIGGER trigger_decrement_tag_learning
  AFTER DELETE ON invoice_tags
  FOR EACH ROW
  EXECUTE FUNCTION decrement_tag_learning_on_removal();
