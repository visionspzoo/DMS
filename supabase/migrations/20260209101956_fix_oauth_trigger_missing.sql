/*
  # Fix Missing OAuth Trigger

  1. Problem
    - Trigger `on_auth_user_created` nie istnieje w tabeli `auth.users`
    - Użytkownicy logujący się przez Google OAuth nie mają automatycznie tworzonych profili
    - Funkcja `handle_new_user()` istnieje, ale nie jest wywoływana

  2. Rozwiązanie
    - Utworzenie triggera który będzie wywoływał funkcję przy każdym nowym użytkowniku
    - Trigger będzie działał dla wszystkich metod logowania (email, OAuth)

  3. Bezpieczeństwo
    - Trigger działa na poziomie auth schema z uprawnieniami SECURITY DEFINER
*/

-- Drop trigger if exists (just in case)
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Create trigger that calls handle_new_user after user is inserted
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();
