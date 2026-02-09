/*
  # Fix Profile Creation for OAuth Users
  
  1. Changes
    - Update handle_new_user() to handle OAuth users properly
    - Add better error handling and logging
    - Ensure SECURITY DEFINER is properly set
    - Add explicit INSERT permission for the function
  
  2. Security
    - Function runs with elevated privileges (SECURITY DEFINER)
    - Only creates profiles for users with valid invitations
*/

-- Recreate the function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER 
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invitation RECORD;
BEGIN
  -- Log the attempt
  RAISE LOG 'Attempting to create profile for user: % (email: %)', NEW.id, NEW.email;
  
  -- Check if there's a pending invitation for this email
  SELECT id, role, department_id, invited_by
  INTO v_invitation
  FROM public.user_invitations
  WHERE LOWER(email) = LOWER(NEW.email)
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Only create profile if invitation exists
  IF FOUND THEN
    RAISE LOG 'Found invitation for user: %, role: %, department: %', NEW.email, v_invitation.role, v_invitation.department_id;
    
    -- Create the profile with data from invitation
    BEGIN
      INSERT INTO public.profiles (id, email, full_name, role, department_id)
      VALUES (
        NEW.id,
        NEW.email,
        COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.raw_user_meta_data->>'name', NEW.email),
        v_invitation.role,
        v_invitation.department_id
      );
      
      RAISE LOG 'Successfully created profile for user: %', NEW.email;
      
      -- Mark invitation as accepted
      UPDATE public.user_invitations
      SET status = 'accepted',
          accepted_at = NOW()
      WHERE id = v_invitation.id;
      
      RAISE LOG 'Marked invitation as accepted for user: %', NEW.email;
      
    EXCEPTION WHEN OTHERS THEN
      RAISE LOG 'Error creating profile for user %: % (SQLSTATE: %)', NEW.email, SQLERRM, SQLSTATE;
      RAISE EXCEPTION 'Database error saving new user: %', SQLERRM;
    END;
  ELSE
    -- No valid invitation found
    RAISE LOG 'No valid invitation found for user: %', NEW.email;
    RAISE WARNING 'User % attempted to register without valid invitation', NEW.email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Ensure the trigger exists and is properly configured
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;

CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_user();

-- Grant necessary permissions
GRANT USAGE ON SCHEMA public TO postgres, authenticated, service_role;
GRANT ALL ON public.profiles TO postgres, service_role;
GRANT ALL ON public.user_invitations TO postgres, service_role;
