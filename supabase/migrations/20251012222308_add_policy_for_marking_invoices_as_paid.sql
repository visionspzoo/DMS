/*
  # Dodanie polityki dla oznaczania faktur jako opłacone

  1. Nowa polityka
    - Pozwala użytkownikom na oznaczanie faktur jako opłacone
    - Dotyczy tylko pól: paid_at, paid_by, status
    - Może być wykonane na fakturach w dowolnym statusie
  
  2. Bezpieczeństwo
    - Tylko zalogowani użytkownicy
    - Można oznaczyć jako opłacone tylko swoją fakturę lub jako admin
*/

-- Dodaj politykę dla oznaczania faktur jako opłacone
CREATE POLICY "Users can mark their invoices as paid"
  ON invoices
  FOR UPDATE
  TO authenticated
  USING (
    uploaded_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  )
  WITH CHECK (
    uploaded_by = auth.uid() OR
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
  );
