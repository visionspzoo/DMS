/*
  # Naprawa uprawnień kierowników i specjalistów dla faktur
  
  ## Problem
  Kierownicy i specjaliści nie mogą:
  1. Akceptować faktur (przejście draft → waiting lub waiting → accepted)
  2. Przesyłać faktur do innych działów
  3. Oznaczać faktur jako opłacone
  
  ## Rozwiązanie
  1. Zaktualizuj zasadę "Users can mark their invoices as paid" aby uwzględnić kierowników i specjalistów
  2. Uproszczona zasada akceptacji dla kierowników i specjalistów
  3. Uproszczona zasada transferu między działami
*/

-- ============================================================================
-- KROK 1: Usuń stare restrykcyjne zasady
-- ============================================================================

DROP POLICY IF EXISTS "Users can mark their invoices as paid" ON invoices;
DROP POLICY IF EXISTS "Allow approval by current approver" ON invoices;

-- ============================================================================
-- KROK 2: Nowe uproszczone zasady dla kierowników i specjalistów
-- ============================================================================

-- Kierownicy i specjaliści mogą oznaczać faktury jako opłacone w swoim dziale
CREATE POLICY "Managers and specialists can mark department invoices as paid"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin lub CEO może wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    -- Lub własna faktura
    OR uploaded_by = auth.uid()
    -- Lub jest aktualnym akceptującym
    OR current_approver_id = auth.uid()
    -- Lub kierownik/dyrektor działu do którego należy faktura
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) IN ('Kierownik', 'Dyrektor')
      AND department_id IN (
        SELECT id FROM departments 
        WHERE manager_id = auth.uid() OR director_id = auth.uid()
      )
    )
    -- Lub specjalista może oznaczać swoje faktury jako opłacone
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND uploaded_by = auth.uid()
    )
  )
  WITH CHECK (true);

-- Kierownicy i dyrektorzy mogą akceptować faktury w swoim dziale
CREATE POLICY "Managers and directors can approve department invoices"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin lub CEO może wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    -- Lub jest aktualnym akceptującym (dla statusu waiting)
    OR (current_approver_id = auth.uid() AND status = 'waiting')
    -- Lub kierownik może akceptować faktury draft specjalistów w swoim dziale
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND status = 'draft'
      AND department_id IN (
        SELECT id FROM departments WHERE manager_id = auth.uid()
      )
      AND (
        -- Może akceptować faktury specjalistów
        (SELECT role FROM profiles WHERE id = uploaded_by) = 'Specjalista'
        -- Lub własne faktury
        OR uploaded_by = auth.uid()
      )
    )
    -- Lub dyrektor może akceptować faktury draft kierowników i specjalistów w swoim dziale
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND status = 'draft'
      AND department_id IN (
        SELECT id FROM departments WHERE director_id = auth.uid()
      )
      AND (
        -- Może akceptować faktury kierowników i specjalistów
        (SELECT role FROM profiles WHERE id = uploaded_by) IN ('Kierownik', 'Specjalista')
        -- Lub własne faktury
        OR uploaded_by = auth.uid()
      )
    )
  )
  WITH CHECK (true);

-- Kierownicy i specjaliści mogą przesyłać faktury między działami
CREATE POLICY "Managers and specialists can transfer invoices"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin lub CEO może wszystko
    (SELECT is_admin FROM profiles WHERE id = auth.uid()) = true
    OR (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
    -- Lub własna faktura
    OR uploaded_by = auth.uid()
    -- Lub jest aktualnym akceptującym
    OR current_approver_id = auth.uid()
    -- Lub kierownik/dyrektor działu do którego należy faktura
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) IN ('Kierownik', 'Dyrektor')
      AND department_id IN (
        SELECT id FROM departments 
        WHERE manager_id = auth.uid() OR director_id = auth.uid()
      )
    )
    -- Lub specjalista może przesyłać swoje faktury
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
      AND uploaded_by = auth.uid()
    )
  )
  WITH CHECK (true);
