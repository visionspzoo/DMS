/*
  # Rozszerzenie dostępu Dyrektora do faktur działowych

  ## Zmiany
  1. Dyrektor może widzieć wszystkie faktury z działów, których jest dyrektorem (director_id)
  2. Dyrektor może edytować faktury z działów, których jest dyrektorem
  3. Dotyczy wszystkich statusów: draft, waiting, accepted, paid, w weryfikacji

  ## Uzasadnienie
  Dyrektor działu powinien mieć pełny wgląd i kontrolę nad fakturami swojego działu,
  niezależnie od tego czy jest przypisany do tego działu jako członek (department_id w profiles).
*/

-- Usuń starą politykę SELECT dla invoices
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Utwórz nową politykę SELECT z dostępem dla Dyrektorów działowych
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
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
        OR department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        -- Dyrektor widzi drafty z działów, których jest dyrektorem
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
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
            -- Faktury bezpośrednio przypisane do działu dyrektora
            department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            -- Lub faktury w invoice_departments dla działów dyrektora
            OR EXISTS (
              SELECT 1 FROM invoice_departments id
              WHERE id.invoice_id = invoices.id
              AND id.department_id IN (
                SELECT d.id FROM departments d WHERE d.director_id = auth.uid()
              )
            )
            -- Lub faktury z hierarchii działów dyrektora
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

-- Usuń starą politykę UPDATE dla invoices
DROP POLICY IF EXISTS "Users can update invoices they have access to" ON invoices;

-- Utwórz nową politykę UPDATE z dostępem dla Dyrektorów działowych
CREATE POLICY "Users can update invoices they have access to"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR current_approver_id = auth.uid()
    
    -- Draft invoices - pozwól edytować osobom z tego samego działu
    OR (
      status = 'draft'
      AND EXISTS (
        SELECT 1 FROM invoice_departments id
        WHERE id.invoice_id = invoices.id
        AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
    )
    
    -- Kierownik może edytować faktury ze swojego działu
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND (
        EXISTS (
          SELECT 1 FROM invoice_departments id
          JOIN profiles uploader ON uploader.id = invoices.uploaded_by
          WHERE id.invoice_id = invoices.id
          AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        )
        OR department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
      )
    )
    
    -- Dyrektor może edytować faktury z działów, których jest dyrektorem
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND (
        -- Faktury bezpośrednio przypisane do działu dyrektora
        department_id IN (
          SELECT id FROM departments WHERE director_id = auth.uid()
        )
        -- Lub faktury w invoice_departments dla działów dyrektora
        OR EXISTS (
          SELECT 1 FROM invoice_departments id
          WHERE id.invoice_id = invoices.id
          AND id.department_id IN (
            SELECT d.id FROM departments d WHERE d.director_id = auth.uid()
          )
        )
        -- Lub faktury z hierarchii działów
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
    
    -- CEO i Admin mogą edytować wszystko
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  )
  WITH CHECK (true);

-- Zaktualizuj polityki dla ksef_invoices
DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;
DROP POLICY IF EXISTS "View assigned KSEF invoices based on role" ON ksef_invoices;
DROP POLICY IF EXISTS "View unassigned KSEF invoices" ON ksef_invoices;

-- Nowa polityka SELECT dla KSEF invoices
CREATE POLICY "Users can view KSEF invoices based on role and department"
  ON ksef_invoices
  FOR SELECT
  TO authenticated
  USING (
    -- Admin i CEO widzą wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    
    -- Nieprzypisane faktury widzi fetcher, Admin i CEO
    OR (
      transferred_to_department_id IS NULL
      AND transferred_to_invoice_id IS NULL
      AND fetched_by = auth.uid()
    )
    
    -- Przypisane faktury
    OR (
      (transferred_to_department_id IS NOT NULL OR transferred_to_invoice_id IS NOT NULL)
      AND (
        -- Dyrektor widzi faktury z działów, których jest dyrektorem
        (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            transferred_to_department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            OR transferred_to_department_id IN (
              WITH RECURSIVE dept_tree AS (
                SELECT d.id FROM departments d WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                UNION ALL
                SELECT d.id FROM departments d JOIN dept_tree dt ON d.parent_department_id = dt.id
              )
              SELECT id FROM dept_tree
            )
            OR fetched_by = auth.uid()
          )
        )
        
        -- Kierownik widzi faktury ze swojego działu
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND (
            transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            OR fetched_by = auth.uid()
          )
        )
        
        -- Specjalista widzi tylko swoje
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
          AND fetched_by = auth.uid()
        )
      )
    )
  );
