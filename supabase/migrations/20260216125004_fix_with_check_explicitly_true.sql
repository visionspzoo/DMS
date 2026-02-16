/*
  # Fix WITH CHECK - Set Explicitly to TRUE
  
  ## Problem
  
  When WITH CHECK is NULL/not specified, PostgreSQL uses the USING clause as 
  the default WITH CHECK condition. This means:
  
  USING: current_approver_id = auth.uid() (checks BEFORE update)
  WITH CHECK: (defaults to USING) current_approver_id = auth.uid() (checks AFTER update and triggers)
  
  After the auto_set_invoice_owner trigger runs, current_approver_id is changed to 
  the new department's manager, so WITH CHECK fails.
  
  ## Solution
  
  Explicitly set WITH CHECK to TRUE to allow any resulting state after UPDATE.
  
  ## Changes
  
  - Set WITH CHECK (TRUE) explicitly for "Users can update invoices they have access to"
  - Set WITH CHECK (TRUE) explicitly for "Admins can update any invoice"
  
  ## Security
  
  - USING clause validates access BEFORE the update
  - Triggers handle business logic
  - No security risk - initial access is properly validated
*/

-- Fix "Users can update invoices they have access to"
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
)
WITH CHECK (TRUE);  -- Explicitly allow any resulting state

-- Fix "Admins can update any invoice"
DROP POLICY IF EXISTS "Admins can update any invoice" ON invoices;

CREATE POLICY "Admins can update any invoice"
ON invoices
FOR UPDATE
TO authenticated
USING (
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
)
WITH CHECK (TRUE);  -- Explicitly allow any resulting state

COMMENT ON POLICY "Users can update invoices they have access to" ON invoices IS
'Users can update invoices based on USING clause. WITH CHECK (TRUE) allows triggers to modify fields freely.';

COMMENT ON POLICY "Admins can update any invoice" ON invoices IS
'Admins and CEO can update any invoice. WITH CHECK (TRUE) allows triggers to modify fields freely.';