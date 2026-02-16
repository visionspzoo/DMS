/*
  # Rozszerzenie widoczności faktur roboczych dla przełożonych

  ## Zmiany
  1. Dyrektorzy widzą faktury robocze (draft) Kierowników i Specjalistów ze swoich działów
  2. Kierownicy widzą faktury robocze (draft) Specjalistów ze swojego działu
  3. Dyrektorzy i Kierownicy mogą przejmować i akceptować faktury podwładnych

  ## Uzasadnienie
  Przełożeni powinni mieć wgląd w faktury robocze podwładnych i możliwość przejęcia procesu
  akceptacji bez konieczności czekania na działania podwładnych.
*/

-- Usuń starą politykę SELECT
DROP POLICY IF EXISTS "Users can view invoices based on role and department" ON invoices;

-- Nowa polityka SELECT z rozszerzonym dostępem do faktur draft
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
        -- Własne faktury
        uploaded_by = auth.uid()
        OR current_approver_id = auth.uid()
        
        -- Faktury z mojego działu
        OR department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        
        -- Dyrektor widzi drafty z działów, których jest dyrektorem
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
          AND (
            -- Drafty z działów, których jest dyrektorem
            department_id IN (
              SELECT id FROM departments WHERE director_id = auth.uid()
            )
            -- Lub drafty z hierarchii działów
            OR department_id IN (
              WITH RECURSIVE dept_tree AS (
                SELECT d.id FROM departments d WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
                UNION ALL
                SELECT d.id FROM departments d JOIN dept_tree dt ON d.parent_department_id = dt.id
              )
              SELECT id FROM dept_tree
            )
            -- Lub drafty gdzie dział jest w invoice_departments i dyrektor zarządza tym działem
            OR EXISTS (
              SELECT 1 FROM invoice_departments id
              JOIN departments d ON d.id = id.department_id
              WHERE id.invoice_id = invoices.id
              AND d.director_id = auth.uid()
            )
          )
        )
        
        -- Kierownik widzi drafty Specjalistów ze swojego działu
        OR (
          (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
          AND (
            -- Faktury z mojego działu
            department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
            -- Lub faktury uploadowane przez Specjalistę z mojego działu
            OR EXISTS (
              SELECT 1 FROM profiles uploader
              WHERE uploader.id = invoices.uploaded_by
              AND uploader.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
              AND uploader.role = 'Specjalista'
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

-- Usuń starą politykę UPDATE
DROP POLICY IF EXISTS "Users can accept invoices assigned to them" ON invoices;

-- Nowa polityka UPDATE dla akceptacji faktur z możliwością przejęcia przez przełożonych
CREATE POLICY "Users can accept invoices assigned to them"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    uploaded_by = auth.uid()
    OR current_approver_id = auth.uid()
    
    -- Dyrektor może akceptować faktury z działów, których jest dyrektorem
    -- (przejęcie obowiązków Kierownika lub Specjalisty)
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
      )
    )
    
    -- Kierownik może akceptować faktury Specjalistów ze swojego działu
    -- (przejęcie obowiązków Specjalisty)
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND (
        department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        OR EXISTS (
          SELECT 1 FROM invoice_departments id
          WHERE id.invoice_id = invoices.id
          AND id.department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
        )
      )
      AND EXISTS (
        SELECT 1 FROM profiles uploader
        WHERE uploader.id = invoices.uploaded_by
        AND uploader.role IN ('Specjalista', 'Kierownik')
      )
    )
    
    -- CEO może wszystko
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
  )
  WITH CHECK (true);
