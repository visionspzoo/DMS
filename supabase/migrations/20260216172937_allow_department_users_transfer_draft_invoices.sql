/*
  # Pozwól użytkownikom działu przesyłać faktury robocze

  ## Problem
  
  Użytkownicy (specjaliści) nie mogą przesłać faktur roboczych (draft) z ich działu
  do innego działu, nawet jeśli faktury są przypisane do ich działu.
  
  Polityka UPDATE wymaga aby użytkownik był:
  - uploaded_by LUB
  - current_approver_id LUB
  - Kierownik/Dyrektor z tego działu (ale tylko dla faktur NON-DRAFT)
  
  ## Rozwiązanie
  
  Dodaj warunek w polityce UPDATE który pozwala użytkownikom na przesyłanie
  faktur roboczych z ich działu, niezależnie od tego kto je uploadował.
  
  ## Zmiany
  
  - Zaktualizowana polityka "Users can update invoices they have access to"
  - Dodany warunek dla faktur draft: użytkownik może aktualizować draft z jego działu
  
  ## Bezpieczeństwo
  
  - Tylko faktury o statusie 'draft' mogą być przenoszone przez członków działu
  - Faktury z innymi statusami wymagają uploaded_by lub current_approver_id
  - CEO i Admini mają pełny dostęp
*/

-- Drop existing policy
DROP POLICY IF EXISTS "Users can update invoices they have access to" ON invoices;

-- Create updated policy that allows department members to transfer draft invoices
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
  -- User can update draft invoices from their department
  (
    status = 'draft'
    AND EXISTS (
      SELECT 1 FROM invoice_departments id
      WHERE id.invoice_id = invoices.id
      AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
    )
  )
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
WITH CHECK (TRUE);  -- Allow any resulting state after triggers

COMMENT ON POLICY "Users can update invoices they have access to" ON invoices IS
'Users can update invoices they uploaded, assigned to them, or draft invoices from their department. WITH CHECK (TRUE) allows triggers to modify fields freely.';
