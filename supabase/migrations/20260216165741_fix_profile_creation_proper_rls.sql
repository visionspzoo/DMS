/*
  # Naprawa tworzenia profilu przez trigger - poprawne RLS

  1. Problem
    - Poprzednia migracja próbowała użyć SET LOCAL role postgres
    - To nie zadziała w Supabase
    - Policy "Trigger can create profiles for invited users" ma błędną składnię

  2. Rozwiązanie
    - Naprawić policy aby sprawdzała email z wstawianego rekordu
    - Usunąć SET LOCAL role z funkcji handle_new_user
*/

-- Usuń błędną policy
DROP POLICY IF EXISTS "Trigger can create profiles for invited users" ON profiles;

-- Dodaj poprawną policy która pozwala na INSERT jeśli istnieje zaproszenie dla tego emaila
CREATE POLICY "Allow profile creation for invited users"
ON profiles
FOR INSERT
TO authenticated
WITH CHECK (
  -- Sprawdź czy istnieje aktywne zaproszenie dla tego emaila
  EXISTS (
    SELECT 1 
    FROM user_invitations
    WHERE LOWER(user_invitations.email) = LOWER(email)
      AND user_invitations.status = 'pending'
      AND user_invitations.expires_at > NOW()
  )
);

-- Napraw funkcję handle_new_user - usuń SET LOCAL role
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
  
  RETURN NEW;
END;
$$;
