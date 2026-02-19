/*
  # Add department_id and mpk_code to nip_automation_rules

  ## Summary
  Extends the existing NIP automation rules system with two new assignment fields:

  1. Modified Tables
    - `nip_automation_rules`
      - `department_id` (uuid, nullable, FK to departments) — auto-assign invoice to this department
      - `mpk_code` (text, nullable) — auto-assign this MPK code text to invoice description

  ## Notes
  - Both fields are optional; existing rules are unaffected
  - department_id references the departments table
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'nip_automation_rules' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE nip_automation_rules ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;
