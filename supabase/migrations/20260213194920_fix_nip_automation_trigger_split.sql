/*
  # Fix NIP Automation Trigger - Split BEFORE/AFTER

  Split the automation trigger into two parts:
  1. BEFORE INSERT - sets cost_center_id and auto_accept status on NEW row
  2. AFTER INSERT - inserts tags into invoice_tags junction table

  This is needed because invoice_tags has a FK to invoices,
  so the invoice row must exist before inserting tags.
*/

-- Drop the old combined trigger
DROP TRIGGER IF EXISTS apply_nip_automation_trigger ON invoices;
DROP FUNCTION IF EXISTS apply_nip_automation_on_invoice();

-- BEFORE INSERT: apply cost_center and auto_accept
CREATE OR REPLACE FUNCTION apply_nip_automation_before_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule RECORD;
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

  IF v_rule.auto_accept = true AND NEW.status IN ('draft', 'waiting') THEN
    NEW.status := 'accepted';
    NEW.current_approver_id := NULL;
  END IF;

  RETURN NEW;
END;
$$;

-- AFTER INSERT: apply tags
CREATE OR REPLACE FUNCTION apply_nip_automation_tags_after_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_rule_id uuid;
  v_tag_id uuid;
BEGIN
  IF NEW.supplier_nip IS NULL AND NEW.supplier_name IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT nar.id INTO v_rule_id
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

  IF v_rule_id IS NULL THEN
    RETURN NEW;
  END IF;

  FOR v_tag_id IN
    SELECT tag_id FROM nip_automation_rule_tags WHERE rule_id = v_rule_id
  LOOP
    INSERT INTO invoice_tags (invoice_id, tag_id)
    VALUES (NEW.id, v_tag_id)
    ON CONFLICT (invoice_id, tag_id) DO NOTHING;
  END LOOP;

  RETURN NEW;
END;
$$;

CREATE TRIGGER apply_nip_automation_before_trigger
  BEFORE INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION apply_nip_automation_before_insert();

CREATE TRIGGER apply_nip_automation_tags_after_trigger
  AFTER INSERT ON invoices
  FOR EACH ROW
  EXECUTE FUNCTION apply_nip_automation_tags_after_insert();
