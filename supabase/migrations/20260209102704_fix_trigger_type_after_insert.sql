/*
  # Naprawa Typu Triggera na AFTER INSERT

  1. Problem
    - Trigger został utworzony jako INSTEAD OF zamiast AFTER INSERT
    - INSTEAD OF triggery zastępują normalną operację INSERT
    - To może powodować że użytkownik nie jest tworzony w auth.users

  2. Rozwiązanie
    - Usunąć istniejący trigger
    - Utworzyć nowy trigger typu AFTER INSERT
    - AFTER INSERT pozwala na normalne dodanie użytkownika, a następnie wywołanie funkcji

  3. Funkcja
    - Poprawienie funkcji żeby działała z uprawnieniami service_role
    - Funkcja SECURITY DEFINER ma pełne uprawnienia i może obejść RLS
*/

-- Usuń stary trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

-- Popraw funkcję - upewnij się że ma prawo obejść RLS
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
  -- Log start
  RAISE LOG 'handle_new_user triggered for user: % (id: %)', NEW.email, NEW.id;

  -- Sprawdź czy profil już istnieje
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = NEW.id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    RAISE LOG 'Profile already exists for user: %, skipping creation', NEW.email;
    RETURN NEW;
  END IF;

  RAISE LOG 'Searching for invitation for email: %', NEW.email;

  -- Szukaj zaproszenia
  SELECT id, role, department_id, invited_by
  INTO v_invitation
  FROM public.user_invitations
  WHERE LOWER(email) = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND THEN
    RAISE LOG 'Found invitation for %, role: %, department_id: %', NEW.email, v_invitation.role, v_invitation.department_id;
    
    BEGIN
      -- Wstaw profil bezpośrednio (SECURITY DEFINER pomija RLS)
      INSERT INTO public.profiles (id, email, full_name, role, department_id, is_admin)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          split_part(NEW.email, '@', 1)
        ),
        v_invitation.role,
        v_invitation.department_id,
        false
      );

      RAISE LOG 'Successfully created profile for user: %', NEW.email;

      -- Oznacz zaproszenie jako zaakceptowane
      UPDATE public.user_invitations
      SET status = 'accepted',
          accepted_at = NOW()
      WHERE id = v_invitation.id;

      RAISE LOG 'Marked invitation as accepted for user: %', NEW.email;

    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'ERROR creating profile for %: % (SQLSTATE: %)', NEW.email, SQLERRM, SQLSTATE;
      RAISE WARNING 'Could not create profile for %: %', NEW.email, SQLERRM;
    END;
  ELSE
    RAISE LOG 'No valid invitation found for user: %', NEW.email;
    RAISE WARNING 'User % attempted to sign up without valid invitation', NEW.email;
  END IF;

  RETURN NEW;
END;
$$;

-- Stwórz trigger jako AFTER INSERT (nie INSTEAD OF)
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Upewnij się że funkcja ma odpowiednie uprawnienia
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- Sprawdź czy trigger został utworzony poprawnie
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_trigger 
    WHERE tgname = 'on_auth_user_created'
  ) THEN
    RAISE NOTICE 'Trigger on_auth_user_created created successfully';
  ELSE
    RAISE EXCEPTION 'Failed to create trigger on_auth_user_created';
  END IF;
END $$;
