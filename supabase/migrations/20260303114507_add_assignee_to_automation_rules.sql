/*
  # Add assignee to NIP automation rules

  ## Summary
  Adds the ability to assign a specific person (user) as the owner/approver of an invoice
  when an automation rule matches. This extends the existing automation rules feature.

  ## Changes
  - `nip_automation_rules` table:
    - New column `assignee_id` (uuid, FK to profiles, nullable) — the user who should be
      automatically set as the invoice owner/approver when this rule fires

  ## Trigger update
  - `apply_nip_automation_before_insert()` function updated to also set
    `current_approver_id` on the new invoice when `assignee_id` is defined in the rule
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nip_automation_rules' AND column_name = 'assignee_id'
  ) THEN
    ALTER TABLE nip_automation_rules
      ADD COLUMN assignee_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION apply_nip_automation_before_insert()
RETURNS TRIGGER AS $$
DECLARE
  matching_rule RECORD;
BEGIN
  SELECT r.*
  INTO matching_rule
  FROM nip_automation_rules r
  WHERE r.is_active = true
    AND (
      (NEW.supplier_nip IS NOT NULL AND r.supplier_nip = NEW.supplier_nip)
      OR (NEW.supplier_nip IS NULL AND r.supplier_nip IS NULL AND r.supplier_name IS NOT NULL
          AND lower(NEW.supplier_name) = lower(r.supplier_name))
    )
  ORDER BY
    CASE WHEN r.supplier_nip IS NOT NULL THEN 0 ELSE 1 END
  LIMIT 1;

  IF FOUND THEN
    IF matching_rule.cost_center_id IS NOT NULL AND NEW.cost_center_id IS NULL THEN
      NEW.cost_center_id := matching_rule.cost_center_id;
    END IF;

    IF matching_rule.department_id IS NOT NULL AND NEW.department_id IS NULL THEN
      NEW.department_id := matching_rule.department_id;
    END IF;

    IF matching_rule.auto_accept = true THEN
      NEW.status := 'accepted';
      NEW.current_approver_id := NULL;
    ELSIF matching_rule.assignee_id IS NOT NULL THEN
      NEW.current_approver_id := matching_rule.assignee_id;
    END IF;

    IF matching_rule.auto_bez_mpk = true THEN
      NEW.bez_mpk := true;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
