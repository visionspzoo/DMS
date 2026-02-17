/*
  # Napraw widoczność faktur według roli właściciela

  ## Problem

  Obecna polityka SELECT pozwala każdemu użytkownikowi w dziale widzieć wszystkie faktury draft,
  włącznie z fakturami innych specjalistów, kierowników i dyrektorów.

  ## Wymagania

  1. **Faktury specjalisty (draft)** - widoczne dla:
     - Samego specjalisty (właściciel)
     - Kierownika działu
     - Dyrektora działu
     - NIE dla innych specjalistów

  2. **Faktury kierownika (draft)** - widoczne dla:
     - Samego kierownika (właściciel)
     - Dyrektora działu
     - NIE dla specjalistów
     - NIE dla innych kierowników

  3. **Faktury dyrektora (draft)** - widoczne dla:
     - Samego dyrektora (właściciel)
     - NIE dla innych użytkowników

  ## Rozwiązanie

  Zmień politykę SELECT aby sprawdzała rolę właściciela faktury (uploaded_by):
  - Usuń ogólny warunek `department_id = user_department`
  - Dodaj warunki sprawdzające rolę właściciela i rolę przeglądającego
*/

-- Usuń starą politykę SELECT
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Nowa polityka SELECT z właściwą kontrolą widoczności według roli
CREATE POLICY "Users can view invoices based on role and department"
  ON invoices
  FOR SELECT
  TO authenticated
  USING (
    -- CEO i Admin widzą wszystko
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    
    -- Faktury draft
    OR (
      status = 'draft'
      AND (
        -- 1. Własne faktury (każdy widzi swoje)
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
        
        -- 2. Dyrektor widzi faktury draft Kierowników i Specjalistów ze swoich działów
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            -- Sprawdź czy dyrektor zarządza działem faktury
            department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            OR department_id IN (
              WITH RECURSIVE dept_tree AS (
                SELECT d.id FROM departments d WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                UNION ALL
                SELECT d.id FROM departments d JOIN dept_tree dt ON d.parent_department_id = dt.id
              )
              SELECT id FROM dept_tree
            )
            OR EXISTS (
              SELECT 1 FROM invoice_departments id
              JOIN departments d ON d.id = id.department_id
              WHERE id.invoice_id = invoices.id
              AND d.director_id = auth.uid()
            )
          )
          -- I właściciel faktury NIE jest Dyrektorem (dyrektorzy widzą tylko swoje)
          AND EXISTS (
            SELECT 1 FROM profiles uploader
            WHERE uploader.id = invoices.uploaded_by
            AND uploader.role IN ('Specjalista', 'Kierownik')
          )
        )
        
        -- 3. Kierownik widzi faktury draft Specjalistów ze swojego działu
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          -- I właściciel faktury jest Specjalistą
          AND EXISTS (
            SELECT 1 FROM profiles uploader
            WHERE uploader.id = invoices.uploaded_by
            AND uploader.role = 'Specjalista'
          )
        )
      )
    )
    
    -- Faktury nie-draft (waiting, accepted, paid, etc.)
    OR (
      status <> 'draft'
      AND (
        uploaded_by = auth.uid()
        
        -- Dyrektor widzi faktury z działów, których jest dyrektorem
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            OR EXISTS (
              SELECT 1 FROM invoice_departments id
              WHERE id.invoice_id = invoices.id
              AND id.department_id IN (
                SELECT d.id FROM departments d WHERE d.director_id = auth.uid()
              )
            )
            OR EXISTS (
              SELECT 1 FROM invoice_departments id
              WHERE id.invoice_id = invoices.id
              AND id.department_id IN (
                WITH RECURSIVE dept_tree AS (
                  SELECT d.id FROM departments d WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                  UNION ALL
                  SELECT d.id FROM departments d JOIN dept_tree dt ON d.parent_department_id = dt.id
                )
                SELECT id FROM dept_tree
              )
            )
          )
        )
        
        -- Kierownik widzi faktury z jego działu (poza fakturami Dyrektora)
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            LEFT JOIN profiles uploader ON uploader.id = invoices.uploaded_by
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            AND (uploader.role IS NULL OR uploader.role <> 'Dyrektor')
          )
        )
        
        -- Specjalista widzi faktury ze swojego działu
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
          AND EXISTS (
            SELECT 1 FROM invoice_departments id
            WHERE id.invoice_id = invoices.id
            AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          )
        )
      )
    )
  );

COMMENT ON POLICY "Users can view invoices based on role and department" ON invoices IS
'Kontroluje widoczność faktur według roli właściciela i roli użytkownika:
- Faktury draft Specjalisty: widoczne dla Specjalisty, Kierownika i Dyrektora działu
- Faktury draft Kierownika: widoczne dla Kierownika i Dyrektora działu
- Faktury draft Dyrektora: widoczne tylko dla Dyrektora
- Faktury nie-draft: widoczne według hierarchii działu';
