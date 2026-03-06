/*
  # Fix NIP Automation - Use Department Manager/Director When No Assignee

  ## Problem
  When a NIP automation rule assigns an invoice to a department but has no specific
  `assignee_id`, the `apply_nip_automation_before_insert` trigger does NOT set
  `current_approver_id`. This causes KSEF invoices to remain assigned to whoever
  fetched them (e.g. the admin/fetcher user) instead of the department's manager
  or director.

  ## Fix
  When a matching rule has:
  - NO `assignee_id` (nobody specific designated)
  - A `department_id` in the rule OR the invoice already has a `department_id`

  Look up the department's `manager_id` first, then `director_id` as fallback,
  and set `current_approver_id` to that person.

  ## Also fixed
  - `uploaded_by` is set to the department manager/director via the same lookup
    (only when `uploaded_by` is not already set to a manager/director)

  ## Affected Tables
  - `invoices` (BEFORE INSERT trigger)

  ## Security
  - SECURITY DEFINER so the trigger can read from `departments`
*/

CREATE OR REPLACE FUNCTION apply_nip_automation_before_insert()
RETURNS TRIGGER AS $$
DECLARE
  matching_rule RECORD;
  dept_id uuid;
  dept_manager_id uuid;
  dept_director_id uuid;
BEGIN
  -- Skip if no supplier info to match on
  IF NEW.supplier_nip IS NULL AND NEW.supplier_name IS NULL THEN
    RETURN NEW;
  END IF;

  -- Find matching NIP automation rule (NIP takes priority over name)
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

  IF NOT FOUND THEN
    RETURN NEW;
  END IF;

  -- Apply cost center if not already set
  IF matching_rule.cost_center_id IS NOT NULL AND NEW.cost_center_id IS NULL THEN
    NEW.cost_center_id := matching_rule.cost_center_id;
  END IF;

  -- Apply department if not already set
  IF matching_rule.department_id IS NOT NULL AND NEW.department_id IS NULL THEN
    NEW.department_id := matching_rule.department_id;
  END IF;

  -- Apply bez_mpk flag if rule says so
  IF matching_rule.auto_bez_mpk = true THEN
    NEW.bez_mpk := true;
  END IF;

  -- Determine the target department for manager/director lookup
  dept_id := COALESCE(matching_rule.department_id, NEW.department_id);

  -- Apply approver based on rule priority:
  -- 1. auto_accept → mark as accepted, no approver needed
  -- 2. assignee_id set → use that specific person
  -- 3. department has manager → use manager
  -- 4. department has director → use director
  IF matching_rule.auto_accept = true THEN
    NEW.status := 'accepted';
    NEW.current_approver_id := NULL;
  ELSIF matching_rule.assignee_id IS NOT NULL THEN
    NEW.current_approver_id := matching_rule.assignee_id;
  ELSIF dept_id IS NOT NULL THEN
    -- Look up the department's manager and director
    SELECT d.manager_id, d.director_id
    INTO dept_manager_id, dept_director_id
    FROM departments d
    WHERE d.id = dept_id;

    IF dept_manager_id IS NOT NULL THEN
      NEW.current_approver_id := dept_manager_id;
    ELSIF dept_director_id IS NOT NULL THEN
      NEW.current_approver_id := dept_director_id;
    END IF;

    -- Also fix uploaded_by if it's currently set to someone outside this department
    -- (i.e. the KSEF fetcher who is not the manager/director)
    -- Only override if uploaded_by is not already the manager or director
    IF NEW.source = 'ksef' AND dept_id IS NOT NULL THEN
      IF dept_manager_id IS NOT NULL AND NEW.uploaded_by != dept_manager_id THEN
        -- Check if uploaded_by is a manager or director of this department
        -- If not, set to department manager
        IF NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = NEW.uploaded_by
            AND p.id = dept_manager_id
        ) AND NOT EXISTS (
          SELECT 1 FROM profiles p
          WHERE p.id = NEW.uploaded_by
            AND p.id = dept_director_id
        ) THEN
          NEW.uploaded_by := dept_manager_id;
        END IF;
      ELSIF dept_director_id IS NOT NULL AND dept_manager_id IS NULL AND NEW.uploaded_by != dept_director_id THEN
        NEW.uploaded_by := dept_director_id;
      END IF;
    END IF;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
