/*
  # Naprawa widoczności faktur po przesłaniu do innego działu

  ## Problem

  Gdy użytkownik przesyła fakturę do innego działu, faktura nadal była widoczna dla niego
  bo warunek `uploaded_by = auth.uid()` nie sprawdzał czy faktura jest w dziale użytkownika.

  ## Rozwiązanie

  Faktury przesłane do innego działu nie będą widoczne dla osoby która je przesłała,
  chyba że:
  - Ma dostęp do docelowego działu
  - Jest to nadal faktura draft
  - Jest przypisana do niej jako current_approver_id

  ## Zmiany

  1. Aktualizacja głównej polityki widoczności faktur
     - Specjalista: widzi faktury które dodał I są w jego dziale (lub draft)
     - Kierownik: widzi faktury z jego działu + przypisane do niego
     - Dyrektor: widzi faktury z jego działu/poddziałów + przypisane do niego
     - CEO: widzi wszystkie
     - Admin: widzi faktury z działów do których ma dostęp
*/

-- Usuń obecną politykę widoczności
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Stwórz nową politykę z poprawną logiką
CREATE POLICY "Users can view invoices based on role and department"
ON invoices
FOR SELECT
TO authenticated
USING (
  -- CEO widzi wszystkie faktury
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Admin widzi faktury ze swoich działów + działów do których ma dostęp
  (
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    AND (
      -- Faktury z własnego działu
      (SELECT department_id FROM profiles WHERE id = auth.uid()) = invoices.department_id
      OR
      -- Faktury z działów do których ma uprawnienia
      EXISTS (
        SELECT 1 FROM user_department_access
        WHERE user_department_access.user_id = auth.uid()
        AND user_department_access.department_id = invoices.department_id
        AND user_department_access.access_type IN ('view', 'workflow')
      )
    )
  )
  OR
  -- Dyrektor widzi faktury ze swojego działu i poddziałów + przypisane do niego
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
    AND (
      -- Faktury przypisane do dyrektora
      current_approver_id = auth.uid()
      OR
      -- Faktury z działu dyrektora lub poddziałów
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
      OR
      -- Faktury które dodał I są w jego dziale lub poddziałach
      (
        uploaded_by = auth.uid()
        AND (
          status = 'draft'
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
    )
  )
  OR
  -- Kierownik widzi faktury ze swojego działu + przypisane do niego
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
    AND (
      -- Faktury przypisane do kierownika
      current_approver_id = auth.uid()
      OR
      -- Faktury od specjalistów z jego działu
      EXISTS (
        SELECT 1
        FROM invoice_departments id
        JOIN profiles uploader ON uploader.id = invoices.uploaded_by
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        AND uploader.role = 'Specjalista'
      )
      OR
      -- Faktury które dodał I są w jego dziale (lub draft)
      (
        uploaded_by = auth.uid()
        AND (
          status = 'draft'
          OR
          EXISTS (
            SELECT 1 FROM invoice_departments id
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          )
        )
      )
    )
  )
  OR
  -- Specjalista widzi TYLKO faktury które dodał I są w jego dziale (lub draft)
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND uploaded_by = auth.uid()
    AND (
      status = 'draft'
      OR
      EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
      OR
      -- Również faktury przypisane bezpośrednio do specjalisty
      current_approver_id = auth.uid()
    )
  )
);

COMMENT ON POLICY "Users can view invoices based on role and department" ON invoices IS
'Użytkownicy widzą faktury na podstawie roli i działu. Faktury przesłane do innego działu nie są widoczne dla osoby która je przesłała (chyba że ma dostęp do docelowego działu).';