/*
  # Dodaj politykę usuwania dla uploaderów

  1. Zmiany
    - Dodaj politykę pozwalającą użytkownikom usuwać własne faktury w statusie "pending"
    
  2. Bezpieczeństwo
    - Tylko właściciel faktury może ją usunąć
    - Tylko faktury w statusie "pending" mogą być usunięte przez uploadera
    - Admini nadal mogą usuwać wszystkie faktury
*/

-- Dodaj politykę dla uploaderów
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies 
    WHERE tablename = 'invoices' 
    AND policyname = 'Uploader can delete own pending invoices'
  ) THEN
    CREATE POLICY "Uploader can delete own pending invoices"
      ON invoices
      FOR DELETE
      TO authenticated
      USING (uploaded_by = auth.uid() AND status = 'pending');
  END IF;
END $$;
