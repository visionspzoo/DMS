/*
  # Update Profile Creation to Require Invitation
  
  1. Changes
    - Update the handle_new_user() trigger to only create profiles for invited users
    - Check for a valid pending invitation before creating profile
    - Automatically assign role and department from invitation
    - Mark invitation as accepted after profile creation
  
  2. Security
    - Only users with valid pending invitations can create accounts
    - Prevents unauthorized account creation
    - Ensures proper role and department assignment based on invitation
  
  3. Important Notes
    - Users without invitations will have their account created but without a profile
    - The frontend should detect this and show an error message
*/

-- Update the function to require invitation
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
    -- No valid invitation found - log this for security monitoring
    RAISE WARNING 'User % attempted to register without valid invitation', NEW.email;
    
    -- Delete the auth user since they don't have an invitation
    DELETE FROM auth.users WHERE id = NEW.id;
    
    RAISE EXCEPTION 'Brak ważnego zaproszenia dla tego adresu email';
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;