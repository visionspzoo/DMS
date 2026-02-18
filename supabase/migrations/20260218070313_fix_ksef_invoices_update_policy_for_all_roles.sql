/*
  # Napraw politykę UPDATE dla ksef_invoices

  ## Problem
  Dyrektor i Kierownik mogą aktualizować ksef_invoices tylko gdy transferred_to_department_id
  jest już ustawione na ich dział. Nie mogą przypisywać nieprzypisanych faktur (gdzie
  transferred_to_department_id IS NULL).

  ## Rozwiązanie
  Dyrektorzy, Kierownicy, CEO, Admini i użytkownicy z can_access_ksef_config
  mogą aktualizować DOWOLNĄ fakturę KSEF - w szczególności nieprzypisane,
  żeby móc je przypisywać do działów.
*/

DROP POLICY IF EXISTS "Users can update KSEF invoices based on role" ON ksef_invoices;

CREATE POLICY "Users can update KSEF invoices based on role"
  ON ksef_invoices
  FOR UPDATE
  TO authenticated
  USING (
    (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.is_admin = true))
    OR (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'CEO'))
    OR (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.can_access_ksef_config = true))
    OR (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Dyrektor'))
    OR (EXISTS (SELECT 1 FROM profiles WHERE profiles.id = auth.uid() AND profiles.role = 'Kierownik'))
    OR (auth.uid() = fetched_by)
  )
  WITH CHECK (true);
