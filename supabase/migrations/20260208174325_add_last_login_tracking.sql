/*
  # Dodanie śledzenia ostatniego logowania

  1. Zmiany w tabeli `profiles`
    - Dodanie kolumny `last_login_at` (timestamp) - data ostatniego logowania użytkownika
  
  2. Funkcje pomocnicze
    - Funkcja do automatycznego aktualizowania `last_login_at` przy logowaniu
*/

-- Dodaj kolumnę last_login_at do tabeli profiles
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS last_login_at timestamptz;

-- Funkcja do aktualizacji last_login_at
CREATE OR REPLACE FUNCTION update_last_login()
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  UPDATE profiles
  SET last_login_at = now()
  WHERE id = auth.uid();
END;
$$;

-- Komentarz do funkcji
COMMENT ON FUNCTION update_last_login() IS 'Updates the last_login_at timestamp for the current authenticated user';
