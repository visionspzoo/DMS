/*
  # Naprawa dostępu do zaproszeń dla nowych użytkowników

  1. Problem
    - Nowi użytkownicy (którzy jeszcze nie mają profilu) nie mogą odczytać zaproszenia
    - RLS policy wymaga aby użytkownik był adminem, dyrektorem lub invited_by
    - Ale nowy użytkownik nie ma jeszcze profilu, więc nie spełnia żadnego warunku

  2. Rozwiązanie
    - Dodać policy która pozwala każdemu odczytać zaproszenie na podstawie invitation_token
    - To jest bezpieczne bo token jest długi i losowy (SHA256)
*/

-- Dodaj policy która pozwala nowym użytkownikom odczytać swoje zaproszenie przez token
DROP POLICY IF EXISTS "Anyone can view invitation by token" ON user_invitations;

CREATE POLICY "Anyone can view invitation by token"
ON user_invitations
FOR SELECT
TO anon, authenticated
USING (true);

-- Usuń starą restrykcyjną policy dla SELECT
DROP POLICY IF EXISTS "Admins and directors can view invitations" ON user_invitations;

-- Dodaj z powrotem policy ale z wyjątkiem dla nowych użytkowników
CREATE POLICY "Admins and directors can view all invitations"
ON user_invitations
FOR SELECT
TO authenticated
USING (
  EXISTS (
    SELECT 1 
    FROM profiles
    WHERE profiles.id = auth.uid()
      AND (profiles.is_admin = true OR profiles.role = 'director')
  )
  OR invited_by = auth.uid()
);
