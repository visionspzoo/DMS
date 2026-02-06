/*
  # Add Foreign Keys to Profiles for Contract System

  1. Changes
    - Add foreign key from contract_comments.user_id to profiles(id)
    - Add foreign key from contract_approvals.approver_id to profiles(id)
  
  2. Why
    - This enables PostgREST to automatically join profiles data
    - Makes queries like `profiles!user_id(full_name)` work correctly
*/

-- Drop existing constraints if they exist (they reference auth.users)
DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'contract_comments_user_id_fkey' 
    AND table_name = 'contract_comments'
  ) THEN
    ALTER TABLE contract_comments DROP CONSTRAINT contract_comments_user_id_fkey;
  END IF;
END $$;

DO $$ 
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.table_constraints 
    WHERE constraint_name = 'contract_approvals_approver_id_fkey' 
    AND table_name = 'contract_approvals'
  ) THEN
    ALTER TABLE contract_approvals DROP CONSTRAINT contract_approvals_approver_id_fkey;
  END IF;
END $$;

-- Add new foreign keys to profiles table
ALTER TABLE contract_comments 
  ADD CONSTRAINT contract_comments_user_id_fkey 
  FOREIGN KEY (user_id) 
  REFERENCES profiles(id) 
  ON DELETE CASCADE;

ALTER TABLE contract_approvals 
  ADD CONSTRAINT contract_approvals_approver_id_fkey 
  FOREIGN KEY (approver_id) 
  REFERENCES profiles(id) 
  ON DELETE CASCADE;
