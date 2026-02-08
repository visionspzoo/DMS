/*
  # Fix Profile Creation Trigger - Better Invitation Check
  
  1. Changes
    - Update handle_new_user() to properly handle missing invitations
    - Don't delete user, just don't create profile
    - Let the frontend handle users without profiles
  
  2. Security
    - Only users with valid pending invitations get profiles
    - Users without profiles cannot access the system
*/

-- Update the function with better error handling
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER AS $$
DECLARE
  v_invitation RECORD;
BEGIN
  -- Check if there's a pending invitation for this email
  SELECT id, role, department_id, invited_by
  INTO v_invitation
  FROM public.user_invitations
  WHERE email = NEW.email
    AND status = 'pending'
    AND expires_at > NOW()
  ORDER BY created_at DESC
  LIMIT 1;
  
  -- Only create profile if invitation exists
  IF FOUND THEN
    -- Create the profile with data from invitation
    INSERT INTO public.profiles (id, email, full_name, role, department_id)
    VALUES (
      NEW.id,
      NEW.email,
      COALESCE(NEW.raw_user_meta_data->>'full_name', NEW.email),
      v_invitation.role,
      v_invitation.department_id
    );
    
    -- Mark invitation as accepted
    UPDATE public.user_invitations
    SET status = 'accepted',
        accepted_at = NOW()
    WHERE id = v_invitation.id;
  ELSE
    -- No valid invitation found
    -- Don't create a profile - the AuthContext will detect this and show error
    RAISE WARNING 'User % attempted to register without valid invitation', NEW.email;
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;