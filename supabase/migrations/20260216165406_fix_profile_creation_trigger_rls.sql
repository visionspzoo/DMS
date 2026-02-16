/*
  # Naprawa RLS dla automatycznego tworzenia profili przez trigger

  1. Problem
    - Trigger handle_new_user nie może wstawić profilu do tabeli profiles
    - Istniejące RLS policies blokują INSERT dla nowych użytkowników
    - Funkcja jest SECURITY DEFINER ale RLS nadal blokuje operację

  2. Rozwiązanie
    - Dodać policy która pozwala na INSERT jeśli istnieje aktywne zaproszenie dla emaila
    - Alternatywnie: wyłączyć RLS dla tej konkretnej operacji w funkcji
    
  3. Wybrane rozwiązanie
    - Zmodyfikować funkcję handle_new_user aby używała SET LOCAL session_authorization
    - To pozwoli ominąć RLS policies dla tej jednej operacji
*/

-- Zmodyfikuj funkcję handle_new_user aby omijała RLS przy tworzeniu profilu
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
  v_profile_exists BOOLEAN;
  v_mapped_role TEXT;
BEGIN
  -- Log start
  RAISE LOG 'handle_new_user triggered for user: % (id: %)', NEW.email, NEW.id;

  -- Sprawdź czy profil już istnieje (używając postgres role aby ominąć RLS)
  EXECUTE format('SET LOCAL role postgres');
  SELECT EXISTS(SELECT 1 FROM public.profiles WHERE id = NEW.id) INTO v_profile_exists;
  
  IF v_profile_exists THEN
    RAISE LOG 'Profile already exists for user: %, skipping creation', NEW.email;
    EXECUTE format('RESET role');
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
    -- Mapuj angielską rolę na polską
    v_mapped_role := map_role_to_polish(v_invitation.role);
    
    RAISE LOG 'Found invitation for %, role: % -> mapped to: %, department_id: %', 
      NEW.email, v_invitation.role, v_mapped_role, v_invitation.department_id;
    
    BEGIN
      -- Wstaw profil z zmapowaną rolą (z uprawnieniami postgres aby ominąć RLS)
      INSERT INTO public.profiles (id, email, full_name, role, department_id, is_admin)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          split_part(NEW.email, '@', 1)
        ),
        v_mapped_role,
        v_invitation.department_id,
        false
      );

      RAISE LOG 'Successfully created profile for user: % with role: %', NEW.email, v_mapped_role;

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

  -- Reset role
  EXECUTE format('RESET role');
  
  RETURN NEW;
END;
$$;

-- Upewnij się że funkcja ma odpowiednie uprawnienia
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- Opcjonalnie: dodaj policy która explicite pozwala na INSERT podczas tworzenia konta
DROP POLICY IF EXISTS "Trigger can create profiles for invited users" ON profiles;

CREATE POLICY "Trigger can create profiles for invited users"
ON profiles
FOR INSERT
TO authenticated
WITH CHECK (
  EXISTS (
    SELECT 1 
    FROM user_invitations
    WHERE LOWER(user_invitations.email) = LOWER(profiles.email)
      AND user_invitations.status = 'pending'
      AND user_invitations.expires_at > NOW()
  )
);
