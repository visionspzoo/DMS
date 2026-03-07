/*
  # Add department_id to purchase_requests

  ## Changes
  - `purchase_requests` table: add `department_id` column (nullable uuid FK to departments)

  This allows each purchase request item to be associated with a specific department.
  The column is nullable so existing rows are not affected.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'purchase_requests' AND column_name = 'department_id'
  ) THEN
    ALTER TABLE purchase_requests ADD COLUMN department_id uuid REFERENCES departments(id) ON DELETE SET NULL;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_purchase_requests_department_id ON purchase_requests(department_id);
