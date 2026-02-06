/*
  # Aktualizacja widoczności faktur według ról i hierarchii działów

  ## Logika widoczności:
    1. **CEO** - widzi wszystkie faktury
    2. **Dyrektor** - widzi wszystkie faktury swojego działu i działów podrzędnych
    3. **Kierownik** - widzi faktury swojego działu (oprócz faktur dodanych przez dyrektorów)
    4. **Specjalista** - widzi tylko własne faktury

  ## Zmiany:
    1. Usunięcie starej policy "Users can view invoices"
    2. Utworzenie nowej policy z logiką hierarchiczną

  ## Bezpieczeństwo:
    - RLS wymusza dostęp tylko do faktur zgodnych z rolą i działem użytkownika
    - Każda rola ma ściśle określony zakres dostępu
*/

-- Usuń starą policy która pozwalała wszystkim na wszystko
DROP POLICY IF EXISTS "Users can view invoices" ON invoices;

-- Nowa policy z hierarchiczną kontrolą dostępu
CREATE POLICY "Users can view invoices based on role and department"
  ON invoices FOR SELECT
  TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM profiles p
      WHERE p.id = auth.uid()
      AND (
        -- CEO widzi wszystkie faktury
        p.role = 'CEO'
        
        OR
        
        -- Dyrektor widzi faktury ze swojego działu i działów podrzędnych
        (
          p.role = 'Dyrektor'
          AND invoices.id IN (
            SELECT inv.id
            FROM invoices inv
            JOIN invoice_departments id ON id.invoice_id = inv.id
            WHERE id.department_id IN (
              -- Dział dyrektora i wszystkie działy podrzędne
              WITH RECURSIVE dept_tree AS (
                SELECT d.id
                FROM departments d
                WHERE d.id = p.department_id
                
                UNION ALL
                
                SELECT d.id
                FROM departments d
                INNER JOIN dept_tree dt ON d.parent_department_id = dt.id
              )
              SELECT id FROM dept_tree
            )
          )
        )
        
        OR
        
        -- Kierownik widzi faktury swojego działu (oprócz faktur dodanych przez dyrektorów)
        (
          p.role = 'Kierownik'
          AND invoices.id IN (
            SELECT inv.id
            FROM invoices inv
            JOIN invoice_departments id ON id.invoice_id = inv.id
            JOIN profiles uploader ON uploader.id = inv.uploaded_by
            WHERE id.department_id = p.department_id
            AND uploader.role != 'Dyrektor'
          )
        )
        
        OR
        
        -- Specjalista widzi tylko własne faktury
        (
          p.role = 'Specjalista'
          AND invoices.uploaded_by = auth.uid()
        )
      )
    )
  );
