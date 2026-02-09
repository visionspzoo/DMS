/*
  # Naprawa Mapowania Ról: Angielski → Polski

  1. Problem
    - Tabela user_invitations używa angielskich nazw: specialist, manager, director, ceo
    - Tabela profiles wymaga polskich nazw: Specjalista, Kierownik, Dyrektor, CEO
    - Trigger handle_new_user kopiuje role bez mapowania
    - Nowi użytkownicy nie mogą otrzymać profilu przez constraint violation

  2. Rozwiązanie
    - Dodać funkcję mapującą angielskie role na polskie
    - Zaktualizować trigger handle_new_user żeby używał mapowania
    - Naprawić profil dla p.dudek@auraherbals.pl

  3. Alternatywa
    - Można było zmienić constraint w profiles żeby akceptował angielskie nazwy
    - Ale lepiej zachować spójność z istniejącymi danymi (polskie nazwy)
*/

-- Funkcja mapująca angielskie role na polskie
CREATE OR REPLACE FUNCTION map_role_to_polish(english_role text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
AS $$
BEGIN
  RETURN CASE LOWER(english_role)
    WHEN 'ceo' THEN 'CEO'
    WHEN 'director' THEN 'Dyrektor'
    WHEN 'manager' THEN 'Kierownik'
    WHEN 'specialist' THEN 'Specjalista'
    ELSE english_role  -- Zwróć oryginalną wartość jeśli nie pasuje
  END;
END;
$$;

-- Zaktualizuj funkcję handle_new_user żeby używała mapowania
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
  v_mapped_role TEXT;
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
    -- Mapuj angielską rolę na polską
    v_mapped_role := map_role_to_polish(v_invitation.role);
    
    RAISE LOG 'Found invitation for %, role: % -> mapped to: %, department_id: %', 
      NEW.email, v_invitation.role, v_mapped_role, v_invitation.department_id;
    
    BEGIN
      -- Wstaw profil z zmapowaną rolą
      INSERT INTO public.profiles (id, email, full_name, role, department_id, is_admin)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(
          NEW.raw_user_meta_data->>'full_name',
          NEW.raw_user_meta_data->>'name',
          split_part(NEW.email, '@', 1)
        ),
        v_mapped_role,  -- Używamy zmapowanej roli
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

  RETURN NEW;
END;
$$;

-- Ponownie stwórz trigger
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Upewnij się że funkcje mają odpowiednie uprawnienia
GRANT EXECUTE ON FUNCTION public.map_role_to_polish(text) TO postgres, service_role, authenticated;
GRANT EXECUTE ON FUNCTION public.handle_new_user() TO postgres, service_role;

-- Napraw profil dla p.dudek@auraherbals.pl
INSERT INTO profiles (id, email, full_name, role, department_id, is_admin)
SELECT 
    u.id,
    u.email,
    COALESCE(
        u.raw_user_meta_data->>'full_name',
        u.raw_user_meta_data->>'name',
        'Paweł Dudek'
    ),
    map_role_to_polish(i.role),  -- Mapuj rolę
    i.department_id,
    false
FROM auth.users u
JOIN user_invitations i ON LOWER(i.email) = LOWER(u.email)
WHERE u.email = 'p.dudek@auraherbals.pl'
  AND i.status = 'pending'
  AND i.expires_at > NOW()
ORDER BY i.created_at DESC
LIMIT 1
ON CONFLICT (id) DO NOTHING;

-- Oznacz zaproszenie jako accepted
UPDATE user_invitations
SET status = 'accepted', accepted_at = NOW()
WHERE email = 'p.dudek@auraherbals.pl'
  AND status = 'pending';
