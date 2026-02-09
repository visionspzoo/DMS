/*
  # Fix Profile Creation - Bypass RLS in Trigger

  1. Problem
    - Trigger działa jako SECURITY DEFINER ale może mieć problem z RLS
    - Funkcja powinna mieć pełne uprawnienia do tworzenia profili

  2. Rozwiązanie
    - Przebudowanie funkcji z jawnym wyłączeniem RLS dla INSERT
    - Dodanie lepszego error handlingu

  3. Bezpieczeństwo
    - Funkcja sprawdza zaproszenia przed utworzeniem profilu
    - Tylko użytkownicy z ważnymi zaproszeniami mogą utworzyć profil
*/

-- Drop i odtwórz funkcję z lepszymi uprawnieniami
DROP FUNCTION IF EXISTS public.handle_new_user() CASCADE;

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_profile_exists BOOLEAN;
BEGIN
  -- Sprawdź czy profil już istnieje
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = NEW.id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    RAISE LOG 'Profile already exists for user: %', NEW.email;
    RETURN NEW;
  END IF;

  -- Szukaj zaproszenia
  SELECT id, role, department_id, invited_by
  INTO v_invitation
  FROM public.user_invitations
  WHERE LOWER(email) = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  -- Tylko twórz profil jeśli jest zaproszenie
  IF FOUND THEN
    RAISE LOG 'Creating profile for user: %, role: %', NEW.email, v_invitation.role;
    
    -- Wyłącz RLS dla tego INSERT (SECURITY DEFINER pozwala na to)
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role, department_id)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          NEW.email
        ),
        v_invitation.role,
        v_invitation.department_id
      );

      RAISE LOG 'Profile created successfully for: %', NEW.email;

      -- Oznacz zaproszenie jako zaakceptowane
      UPDATE public.user_invitations
      SET status = 'accepted',
          accepted_at = NOW()
      WHERE id = v_invitation.id;

      RAISE LOG 'Invitation marked as accepted for: %', NEW.email;

    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'ERROR creating profile for %: % (SQLSTATE: %)', NEW.email, SQLERRM, SQLSTATE;
      -- Nie rzucaj wyjątku - pozwól userowi się zalogować nawet jeśli profil się nie utworzył
      -- Zamiast tego zaloguj błąd
    END;
  ELSE
    RAISE LOG 'No valid invitation for user: %', NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

-- Ponownie stwórz trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Upewnij się że funkcja ma odpowiednie uprawnienia
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO authenticated, anon, service_role;
