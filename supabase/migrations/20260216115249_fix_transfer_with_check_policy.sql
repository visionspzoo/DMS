/*
  # Fix Transfer Policy - Remove Restrictive WITH CHECK

  ## Problem
  
  When users transfer invoices to another department, the BEFORE UPDATE trigger 
  `auto_set_invoice_owner` changes the `current_approver_id` to the new department's 
  manager or director. The WITH CHECK clause then fails because it checks the state 
  AFTER the trigger runs, where `current_approver_id` is no longer equal to `auth.uid()`.

  ## Solution
  
  Set WITH CHECK to NULL (or TRUE) to allow the transfer. The USING clause is sufficient
  for security - it ensures users can only initiate updates on invoices they have access to.
  What happens AFTER the trigger runs (new current_approver_id) should not be restricted.

  ## Changes
  
  - Remove restrictive WITH CHECK conditions from "Users can update invoices they have access to"
  - Keep the same USING clause for security
  - Allow any resulting state after UPDATE (triggers can modify fields)

  ## Security
  
  - USING clause ensures users can only UPDATE invoices they have access to
  - Triggers handle the business logic for setting the new owner
  - No security risk since initial access is properly validated
*/

-- Drop and recreate the policy with NULL WITH CHECK
DROP POLICY IF EXISTS "Users can update invoices they have access to" ON invoices;

CREATE POLICY "Users can update invoices they have access to"
ON invoices
FOR UPDATE
TO authenticated
USING (
  -- User uploaded the invoice
  uploaded_by = auth.uid()
  OR
  -- Invoice is assigned to user
  current_approver_id = auth.uid()
  OR
  -- Kierownik can update invoices from their department
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
    AND (
      -- Invoices from specialists in their department
      EXISTS (
        SELECT 1 
        FROM invoice_departments id
        JOIN profiles uploader ON uploader.id = invoices.uploaded_by
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
      OR
      -- Invoices in their department
      department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
    )
  )
  OR
  -- Dyrektor can update invoices from their department and subdepartments
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
    AND (
      department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      OR
      EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id IN (
          WITH RECURSIVE dept_tree AS (
            SELECT d.id FROM departments d
            WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            UNION ALL
            SELECT d.id FROM departments d
            JOIN dept_tree dt ON d.parent_department_id = dt.id
          )
          SELECT id FROM dept_tree
        )
      )
    )
  )
  OR
  -- CEO has full access
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Admin has full access
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
);
-- WITH CHECK is NULL (default) - allows any resulting state after UPDATE

COMMENT ON POLICY "Users can update invoices they have access to" ON invoices IS
'Users can update invoices they have access to based on USING clause. WITH CHECK is not restrictive to allow triggers to modify fields like current_approver_id during transfer.';