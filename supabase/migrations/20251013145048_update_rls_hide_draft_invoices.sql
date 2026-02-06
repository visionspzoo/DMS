/*
  # Update RLS to Hide Draft Invoices from Other Users

  1. Changes
    - Drop and recreate SELECT policy to hide draft invoices from other users
    - Draft invoices are only visible to their creator
    - Non-draft invoices follow the existing role-based visibility rules
    
  2. Updated Policy Logic
    - CEO: Sees all non-draft invoices
    - Dyrektor: Sees non-draft invoices from their department tree
    - Kierownik: Sees non-draft invoices from their department (excluding Dyrektor uploads)
    - Specjalista: Sees only their own invoices (both draft and non-draft)
    - All users: See only their own draft invoices
    
  3. Security
    - Draft invoices are private to the creator
    - Only after submitting to circulation (status changes from draft to waiting) 
      do they become visible to managers
*/

-- Drop existing SELECT policy
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Create new SELECT policy that hides draft invoices from other users
CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- User's own invoices (including drafts)
    (uploaded_by = auth.uid())
    OR
    -- Non-draft invoices visible based on role
    (
      status != 'draft'
      AND
      (
        -- CEO can see all non-draft invoices
        (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
        OR
        -- Dyrektor can see non-draft invoices from their department tree
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND EXISTS (
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
        OR
        -- Kierownik can see non-draft invoices from their department (excluding Dyrektor uploads)
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND uploader.role != 'Dyrektor'
          )
        )
      )
    )
  );
