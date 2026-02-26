/*
  # Fix NIP Automation Trigger - Apply auto_bez_mpk

  ## Summary
  Updates the BEFORE INSERT trigger for NIP automation rules to also
  apply the `auto_bez_mpk` flag when a matching rule has it enabled.

  1. Modified Functions
    - `apply_nip_automation_before_insert` — now reads `auto_bez_mpk` from the rule
      and sets `bez_mpk = true` on the new invoice row when the rule flag is enabled.
*/

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

  SELECT nar.id, nar.auto_accept, nar.auto_bez_mpk, nar.cost_center_id
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

  IF v_rule.auto_bez_mpk = true THEN
    NEW.bez_mpk := true;
  END IF;

  RETURN NEW;
END;
$$;
