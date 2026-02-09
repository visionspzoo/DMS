/*
  # Ograniczenie Widoczności Faktur dla Specjalistów

  1. Problem
    - Specjaliści widzą wszystkie faktury ze swojego działu
    - Powinni widzieć tylko faktury które sami dodali

  2. Zmiana
    - Aktualizacja polityki RLS dla tabeli `invoices`
    - Aktualizacja polityki RLS dla tabeli `ksef_invoices`
    - Specjalista widzi tylko:
      * Faktury gdzie `uploaded_by = auth.uid()` (dla invoices)
      * Faktury gdzie `fetched_by = auth.uid()` (dla ksef_invoices)

  3. Bez Zmian
    - Kierownik: widzi wszystkie faktury w swoim dziale
    - Dyrektor: widzi wszystkie faktury w swoim dziale i poddziałach
    - CEO: widzi wszystkie faktury
    - Admin: widzi faktury z działów do których ma dostęp
*/

-- Usuń wszystkie istniejące polityki SELECT dla invoices
DROP POLICY IF EXISTS "Users can view invoices from their department or granted access" ON invoices;
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;
DROP POLICY IF EXISTS "Admins can view invoices from accessible departments" ON invoices;

-- Utwórz nową główną politykę dla invoices
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
  -- Kierownik widzi faktury ze swojego działu (dodane przez niego lub przez Specjalistów)
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
    AND (
      uploaded_by = auth.uid()
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

-- Zaktualizuj politykę dla ksef_invoices
DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;

CREATE POLICY "Users can view KSEF invoices based on role and department"
ON ksef_invoices
FOR SELECT
TO authenticated
USING (
  -- Admin widzi wszystkie faktury KSeF
  (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  OR
  -- CEO widzi wszystkie faktury KSeF
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Dyrektor widzi faktury KSeF ze swojego działu i poddziałów
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
    AND transferred_to_department_id IN (
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
  -- Kierownik widzi faktury KSeF ze swojego działu
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
    AND transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
  )
  OR
  -- Specjalista widzi TYLKO faktury KSeF które sam pobrał
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND fetched_by = auth.uid()
  )
);

-- Dodaj komentarze wyjaśniające
COMMENT ON POLICY "Users can view invoices based on role and department" ON invoices IS
'Główna polityka widoczności faktur:
- CEO: wszystkie faktury
- Dyrektor: faktury ze swojego działu i poddziałów
- Kierownik: faktury ze swojego działu (własne + od Specjalistów)
- Specjalista: TYLKO własne faktury (uploaded_by)
- Admin: faktury ze swoich działów';

COMMENT ON POLICY "Users can view KSEF invoices based on role and department" ON ksef_invoices IS
'Polityka widoczności faktur KSeF:
- CEO: wszystkie faktury
- Dyrektor: faktury ze swojego działu i poddziałów
- Kierownik: faktury ze swojego działu
- Specjalista: TYLKO faktury które sam pobrał (fetched_by)';
