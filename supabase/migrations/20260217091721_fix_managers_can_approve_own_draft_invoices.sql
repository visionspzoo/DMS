/*
  # Naprawa: Kierownicy mogą akceptować własne faktury draft
  
  ## Problem
  Kierownik nie może przesłać swojej własnej faktury draft do dyrektora,
  bo zasada "Managers and directors can approve department invoices" 
  wymaga, aby uploader był specjalistą.
  
  ## Rozwiązanie
  Zaktualizuj zasadę aby kierownik mógł akceptować:
  1. Faktury specjalistów w swoim dziale
  2. SWOJE WŁASNE faktury draft (aby przesłać je do dyrektora)
*/

DROP POLICY IF EXISTS "Managers and directors can approve department invoices" ON invoices;

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
    -- Lub własna faktura (kierownik może przesłać swoją fakturę do dyrektora)
    OR uploaded_by = auth.uid()
    -- Lub kierownik może akceptować faktury draft specjalistów w swoim dziale
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Kierownik'
      AND status = 'draft'
      AND department_id IN (
        SELECT id FROM departments WHERE manager_id = auth.uid()
      )
      AND (SELECT role FROM profiles WHERE id = uploaded_by) = 'Specjalista'
    )
    -- Lub dyrektor może akceptować faktury draft kierowników i specjalistów w swoim dziale
    OR (
      (SELECT role FROM profiles WHERE id = auth.uid()) = 'Dyrektor'
      AND status = 'draft'
      AND department_id IN (
        SELECT id FROM departments WHERE director_id = auth.uid()
      )
      AND (SELECT role FROM profiles WHERE id = uploaded_by) IN ('Kierownik', 'Specjalista')
    )
  )
  WITH CHECK (true);
