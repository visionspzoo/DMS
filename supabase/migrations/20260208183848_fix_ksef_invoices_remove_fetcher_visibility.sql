/*
  # Naprawa widoczności faktur KSeF - usunięcie dostępu na podstawie pobrania

  ## Problem
  Aktualna policy RLS dla ksef_invoices pozwala użytkownikowi widzieć WSZYSTKIE faktury,
  które sam pobrał z KSeF, nawet jeśli zostały one automatycznie przypisane do innego działu.

  Przykład:
  - Użytkownik s.hoffman (Kierownik IT) pobiera faktury z KSeF
  - Niektóre faktury są automatycznie przypisane do działu Marketing (na podstawie mapowania NIP)
  - s.hoffman nadal widzi te faktury, mimo że nie należą do jego działu

  ## Rozwiązanie
  Usunięcie warunku `fetched_by = auth.uid()` z policy.
  Po przypisaniu faktury do działu, widoczność powinna być kontrolowana TYLKO przez hierarchię działów.

  ## Nowa logika
  1. **Specjaliści**
     - Widzą TYLKO faktury KSeF przypisane do ich działu

  2. **Kierownicy**
     - Widzą faktury KSeF przypisane do ich działu

  3. **Dyrektorzy**
     - Widzą faktury KSeF przypisane do ich działu i działów podrzędnych

  4. **CEO**
     - Widzi wszystkie faktury KSeF

  5. **Admini**
     - Widzą wszystko

  6. **Faktury bez przypisanego działu (transferred_to_department_id IS NULL)**
     - Widoczne tylko dla CEO i adminów (do czasu przypisania)

  ## Bezpieczeństwo
  - Ścisła kontrola dostępu według działu
  - Użytkownicy nie widzą faktur z innych działów, nawet jeśli sami je pobrali
*/

-- Usuń starą policy
DROP POLICY IF EXISTS "Users can view KSEF invoices based on role and department" ON ksef_invoices;

-- Nowa policy bez dostępu na podstawie pobrania
CREATE POLICY "Users can view KSEF invoices based on role and department"
  ON ksef_invoices
  FOR SELECT
  TO authenticated
  USING (
    -- Admini widzą wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR
    -- CEO widzi wszystkie faktury KSeF
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    OR
    -- Dyrektor widzi faktury KSeF z całego drzewa działów podrzędnych
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND transferred_to_department_id IN (
        WITH RECURSIVE dept_tree AS (
          -- Dział dyrektora
          SELECT d.id FROM departments d
          WHERE d.id = (SELECT department_id FROM profiles WHERE id = auth.uid())
          
          UNION ALL
          
          -- Wszystkie działy podrzędne
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
    -- Specjalista widzi faktury KSeF ze swojego działu
    (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND transferred_to_department_id = (SELECT department_id FROM profiles WHERE id = auth.uid())
    )
  );
