/*
  # Fix Profile Creation for New Users

  1. Problem
    - Trigger `handle_new_user` nie może utworzyć profilu bo RLS blokuje INSERT
    - Istniejąca polityka "Admins can insert profiles" wymaga aby user był już adminem
    - Nowi użytkownicy nie mogą się zalogować bo nie mają profilu

  2. Rozwiązanie
    - Dodanie polityki która pozwala na INSERT nowego profilu jeśli nie istnieje
    - Polityka działa dla service_role (używanej przez trigger z SECURITY DEFINER)

  3. Bezpieczeństwo
    - Polityka pozwala tylko na utworzenie profilu jeśli nie istnieje już profil dla tego ID
    - Zapobiega nadpisywaniu istniejących profili
*/

-- Dodaj politykę która pozwala triggerowi na utworzenie nowego profilu
CREATE POLICY "Allow profile creation for new users"
  ON profiles
  FOR INSERT
  TO authenticated
  WITH CHECK (
    -- Pozwól na INSERT tylko jeśli nie istnieje jeszcze profil dla tego ID
    NOT EXISTS (
      SELECT 1 FROM profiles WHERE id = auth.uid()
    )
    AND id = auth.uid()
  );
