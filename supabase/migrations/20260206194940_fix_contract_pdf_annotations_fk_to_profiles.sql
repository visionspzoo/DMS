/*
  # Fix contract_pdf_annotations FK to reference profiles

  1. Changes
    - Drop FK from user_id -> auth.users(id)
    - Add FK from user_id -> profiles(id)
    - This enables PostgREST joins with profiles table for user names

  2. Notes
    - profiles.id values match auth.users.id so data integrity is preserved
*/

ALTER TABLE contract_pdf_annotations
  DROP CONSTRAINT IF EXISTS contract_pdf_annotations_user_id_fkey;

ALTER TABLE contract_pdf_annotations
  ADD CONSTRAINT contract_pdf_annotations_user_id_fkey
  FOREIGN KEY (user_id) REFERENCES profiles(id) ON DELETE CASCADE;
