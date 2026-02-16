/*
  # Rozszerzenie uprawnień Kierowników i Dyrektorów dla faktur KSEF
  
  ## Problem
  Faktury KSEF przesłane do działów nie są edytowalne przez Kierowników i Dyrektorów.
  Tylko fetcher (osoba która pobrała fakturę) lub admin mogą nimi zarządzać.
  
  ## Rozwiązanie
  Dodanie policies pozwalających Kierownikom i Dyrektorom na:
  1. Edycję faktur KSEF swoich podwładnych
  2. Usuwanie faktur KSEF swoich podwładnych
  3. Transfer faktur KSEF do innych działów (podobnie jak zwykłe faktury)
  
  ## Zmiany
  1. UPDATE policy - Kierownicy i Dyrektorzy mogą edytować faktury KSEF podwładnych
  2. DELETE policy - Kierownicy i Dyrektorzy mogą usuwać faktury KSEF podwładnych
  
  ## Zasady dostępu
  - Kierownik może zarządzać fakturami KSEF Specjalistów z jego działu
  - Dyrektor może zarządzać fakturami KSEF Specjalistów i Kierowników z jego działu
  - Admin i CEO mają pełny dostęp
  
  ## Bezpieczeństwo
  - Weryfikacja relacji przełożony-podwładny
  - Sprawdzenie przynależności do tego samego działu
  - Zachowanie istniejących uprawnień dla fetcher
*/

-- Drop existing UPDATE policies to recreate them with extended permissions
DROP POLICY IF EXISTS "Users can update KSEF invoices for transfer" ON ksef_invoices;
DROP POLICY IF EXISTS "Update KSEF invoices for transfer" ON ksef_invoices;

-- Create comprehensive UPDATE policy for KSEF invoices
CREATE POLICY "Users can update KSEF invoices based on role"
  ON ksef_invoices
  FOR UPDATE
  TO authenticated
  USING (
    -- Admin może wszystko
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    
    -- CEO może wszystko
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
    
    -- Użytkownicy z dostępem do konfiguracji KSEF
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.can_access_ksef_config = true
    )
    
    -- Fetcher może edytować swoje faktury
    OR auth.uid() = fetched_by
    
    -- Dyrektor może edytować faktury KSEF z działów, których jest dyrektorem
    OR (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Dyrektor'
      )
      AND transferred_to_department_id IN (
        SELECT id FROM departments WHERE director_id = auth.uid()
      )
    )
    
    -- Kierownik może edytować faktury KSEF ze swojego działu
    -- (jeśli fetcher jest Specjalistą z tego samego działu)
    OR (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Kierownik'
      )
      AND transferred_to_department_id = (
        SELECT department_id FROM profiles WHERE id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM profiles fetcher_profile
        WHERE fetcher_profile.id = ksef_invoices.fetched_by
        AND fetcher_profile.role = 'Specjalista'
        AND fetcher_profile.department_id = (
          SELECT department_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  )
  WITH CHECK (true);

-- Drop existing DELETE policies
DROP POLICY IF EXISTS "Users can delete KSEF invoices they fetched" ON ksef_invoices;

-- Create comprehensive DELETE policy for KSEF invoices
CREATE POLICY "Users can delete KSEF invoices based on role"
  ON ksef_invoices
  FOR DELETE
  TO authenticated
  USING (
    -- Admin może usuwać wszystkie faktury
    EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.is_admin = true
    )
    
    -- CEO może usuwać wszystkie faktury
    OR EXISTS (
      SELECT 1 FROM profiles
      WHERE profiles.id = auth.uid()
      AND profiles.role = 'CEO'
    )
    
    -- Fetcher może usuwać swoje faktury
    OR auth.uid() = fetched_by
    
    -- Dyrektor może usuwać faktury KSEF z działów, których jest dyrektorem
    OR (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Dyrektor'
      )
      AND transferred_to_department_id IN (
        SELECT id FROM departments WHERE director_id = auth.uid()
      )
    )
    
    -- Kierownik może usuwać faktury KSEF ze swojego działu
    -- (jeśli fetcher jest Specjalistą z tego samego działu)
    OR (
      EXISTS (
        SELECT 1 FROM profiles
        WHERE profiles.id = auth.uid()
        AND profiles.role = 'Kierownik'
      )
      AND transferred_to_department_id = (
        SELECT department_id FROM profiles WHERE id = auth.uid()
      )
      AND EXISTS (
        SELECT 1 FROM profiles fetcher_profile
        WHERE fetcher_profile.id = ksef_invoices.fetched_by
        AND fetcher_profile.role = 'Specjalista'
        AND fetcher_profile.department_id = (
          SELECT department_id FROM profiles WHERE id = auth.uid()
        )
      )
    )
  );

-- Add helpful comments
COMMENT ON POLICY "Users can update KSEF invoices based on role" ON ksef_invoices IS
'Allows users to update KSEF invoices based on their role and relationship:
- Admin and CEO: all invoices
- Fetcher: their own invoices
- Dyrektor: invoices from departments they direct
- Kierownik: invoices from their department (if fetcher is Specjalista)';

COMMENT ON POLICY "Users can delete KSEF invoices based on role" ON ksef_invoices IS
'Allows users to delete KSEF invoices based on their role and relationship:
- Admin and CEO: all invoices
- Fetcher: their own invoices
- Dyrektor: invoices from departments they direct
- Kierownik: invoices from their department (if fetcher is Specjalista)';
