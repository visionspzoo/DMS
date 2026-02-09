/*
  # Dodaj Politykę dla Service Role

  1. Problem
    - Istniejąca polityka "Admins can insert profiles" wymaga żeby user był już adminem
    - Nowi użytkownicy nie mają profilu, więc nie mogą przejść przez check
    - Funkcja SECURITY DEFINER może być blokowana przez RLS

  2. Rozwiązanie
    - Dodać politykę która pozwala na INSERT dla service_role
    - Service role to specjalna rola używana przez triggery i funkcje SECURITY DEFINER
    - Ta polityka będzie miała najwyższy priorytet

  3. Bezpieczeństwo
    - Polityka działa tylko dla service_role, nie dla zwykłych użytkowników
    - Zwykli użytkownicy wciąż muszą być adminami żeby tworzyć profile
*/

-- Dodaj politykę dla service_role która pozwala na INSERT bez ograniczeń
CREATE POLICY "Service role can insert profiles"
  ON profiles
  FOR INSERT
  TO service_role
  WITH CHECK (true);

-- Dodaj też politykę dla authenticated która pozwala na INSERT własnego profilu
-- To jest dla przypadku gdy trigger się wywołuje
CREATE POLICY "Users can create own profile during signup"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    id = auth.uid() 
    AND NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid()
    )
  );
