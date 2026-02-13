/*
  # Create NIP Automation Rules

  1. New Tables
    - `nip_automation_rules`
      - `id` (uuid, primary key)
      - `supplier_nip` (text, nullable) - NIP kontrahenta do dopasowania
      - `supplier_name` (text, nullable) - Nazwa kontrahenta do dopasowania
      - `auto_accept` (boolean) - Automatyczna akceptacja faktur
      - `cost_center_id` (uuid, FK) - Automatyczne przypisanie MPK
      - `is_active` (boolean) - Czy reguła jest aktywna
      - `created_by` (uuid, FK) - Kto utworzył regułę
      - `created_at` / `updated_at` (timestamptz)
    - `nip_automation_rule_tags`
      - `id` (uuid, primary key)
      - `rule_id` (uuid, FK) - Powiązanie z regułą
      - `tag_id` (uuid, FK) - Tag do automatycznego przypisania
      - UNIQUE(rule_id, tag_id)

  2. Security
    - RLS enabled on both tables
    - Only authenticated admins can manage rules
    - All authenticated users can read active rules

  3. Trigger
    - `apply_nip_automation_on_invoice` - Automatycznie stosuje reguły
      po utworzeniu faktury (przypisuje MPK, tagi)
*/

-- NIP automation rules table
CREATE TABLE IF NOT EXISTS nip_automation_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  supplier_nip text,
  supplier_name text,
  auto_accept boolean DEFAULT false,
  cost_center_id uuid REFERENCES cost_centers(id) ON DELETE SET NULL,
  is_active boolean DEFAULT true,
  created_by uuid NOT NULL REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE nip_automation_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read active automation rules"
  ON nip_automation_rules FOR SELECT
  TO authenticated
  USING (is_active = true);

CREATE POLICY "Admins can insert automation rules"
  ON nip_automation_rules FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can update automation rules"
  ON nip_automation_rules FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete automation rules"
  ON nip_automation_rules FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE INDEX IF NOT EXISTS idx_nip_automation_rules_nip ON nip_automation_rules(supplier_nip);
CREATE INDEX IF NOT EXISTS idx_nip_automation_rules_active ON nip_automation_rules(is_active);

-- Junction table for automation rule tags
CREATE TABLE IF NOT EXISTS nip_automation_rule_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  rule_id uuid NOT NULL REFERENCES nip_automation_rules(id) ON DELETE CASCADE,
  tag_id uuid NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
  created_at timestamptz DEFAULT now(),
  UNIQUE(rule_id, tag_id)
);

ALTER TABLE nip_automation_rule_tags ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read automation rule tags"
  ON nip_automation_rule_tags FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM nip_automation_rules
      WHERE nip_automation_rules.id = nip_automation_rule_tags.rule_id
      AND nip_automation_rules.is_active = true
    )
  );

CREATE POLICY "Admins can insert automation rule tags"
  ON nip_automation_rule_tags FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

CREATE POLICY "Admins can delete automation rule tags"
  ON nip_automation_rule_tags FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND is_admin = true)
  );

-- Trigger function to apply automation rules when invoice is inserted
CREATE OR REPLACE FUNCTION apply_nip_automation_on_invoice()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
  v_tag_id uuid;
BEGIN
  IF NEW.supplier_nip IS NULL AND NEW.supplier_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nar.id, nar.auto_accept, nar.cost_center_id
  INTO v_rule
  FROM nip_automation_rules nar
  WHERE nar.is_active = true
    AND (
      (nar.supplier_nip IS NOT NULL AND nar.supplier_nip = NEW.supplier_nip)
      OR (nar.supplier_nip IS NULL AND nar.supplier_name IS NOT NULL 
          AND LOWER(nar.supplier_name) = LOWER(NEW.supplier_name))
    )
  ORDER BY 
    CASE WHEN nar.supplier_nip IS NOT NULL THEN 0 ELSE 1 END
  LIMIT 1;

  IF v_rule IS NULL THEN
    RETURN NEW;
  END IF;

  IF v_rule.cost_center_id IS NOT NULL AND NEW.cost_center_id IS NULL THEN
    NEW.cost_center_id := v_rule.cost_center_id;
  END IF;

  FOR v_tag_id IN
    SELECT tag_id FROM nip_automation_rule_tags WHERE rule_id = v_rule.id
  LOOP
    INSERT INTO invoice_tags (invoice_id, tag_id)
    VALUES (NEW.id, v_tag_id)
    ON CONFLICT (invoice_id, tag_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS apply_nip_automation_trigger ON invoices;
CREATE TRIGGER apply_nip_automation_trigger
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION apply_nip_automation_on_invoice();
