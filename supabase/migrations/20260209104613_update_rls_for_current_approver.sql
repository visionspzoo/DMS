/*
  # Aktualizacja RLS dla Workflow Akceptacji

  1. Zmiana
    - Dodaj widoczność faktur dla użytkowników którzy są current_approver_id
    - Kierownik/Dyrektor widzi faktury przypisane do niego (current_approver_id)
    
  2. Polityki
    - Dodaj warunek: current_approver_id = auth.uid()
*/

-- Zaktualizuj główną politykę widoczności faktur
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

CREATE POLICY "Users can view invoices based on role and department"
ON invoices
FOR SELECT
TO authenticated
USING (
  -- Admin widzi faktury ze swoich działów
  (
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    AND (
      (SELECT department_id FROM profiles WHERE id = auth.uid()) = invoices.department_id
      OR
      EXISTS (
        SELECT 1 FROM user_department_access
        WHERE user_department_access.user_id = auth.uid()
        AND user_department_access.department_id = invoices.department_id
        AND user_department_access.access_type IN ('view', 'workflow')
      )
    )
  )
  OR
  -- CEO widzi wszystkie faktury
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Dyrektor widzi faktury ze swojego działu i poddziałów
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
    AND (
      uploaded_by = auth.uid()
      OR
      current_approver_id = auth.uid()
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
  -- Kierownik widzi faktury ze swojego działu + przypisane do niego
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
    AND (
      uploaded_by = auth.uid()
      OR
      current_approver_id = auth.uid()
      OR
      EXISTS (
        SELECT 1 
        FROM invoice_departments id
        JOIN profiles uploader ON uploader.id = invoices.uploaded_by
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        AND uploader.role = 'Specjalista'
      )
    )
  )
  OR
  -- Specjalista widzi TYLKO faktury które sam dodał
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND uploaded_by = auth.uid()
  )
  OR
  -- Draft faktury widoczne tylko dla twórcy
  (
    uploaded_by = auth.uid()
    AND status = 'draft'
  )
);

-- Dodaj politykę UPDATE dla akceptacji faktur
DROP POLICY IF EXISTS "Users can accept invoices assigned to them" ON invoices;

CREATE POLICY "Users can accept invoices assigned to them"
ON invoices
FOR UPDATE
TO authenticated
USING (
  -- Użytkownik może akceptować faktury przypisane do niego
  current_approver_id = auth.uid()
  OR
  -- Lub jest właścicielem (dla draft)
  (uploaded_by = auth.uid() AND status = 'draft')
  OR
  -- Lub jest CEO/Admin
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('CEO')
  OR
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
)
WITH CHECK (
  current_approver_id = auth.uid()
  OR
  (uploaded_by = auth.uid() AND status = 'draft')
  OR
  (SELECT role FROM profiles WHERE id = auth.uid()) IN ('CEO')
  OR
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
);

-- Komentarz
COMMENT ON POLICY "Users can accept invoices assigned to them" ON invoices IS
'Użytkownicy mogą akceptować faktury które są do nich przypisane (current_approver_id)';
