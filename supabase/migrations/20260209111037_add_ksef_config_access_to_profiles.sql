/*
  # Dodanie Pola Dostępu do Konfiguracji KSEF

  1. Nowe Pole
    - `can_access_ksef_config` (boolean) - określa czy użytkownik ma dostęp do zakładki Konfiguracja KSEF
    
  2. Bezpieczeństwo
    - Domyślnie ustawione na false (tylko uprawnieni użytkownicy)
    - Admini i CEO automatycznie mogą mieć dostęp (kontrolowane przez aplikację)
    
  3. Cel
    - Ograniczenie dostępu do konfiguracji KSEF tylko dla uprawnionych osób
*/

-- Dodaj pole do profili
ALTER TABLE profiles 
ADD COLUMN IF NOT EXISTS can_access_ksef_config boolean DEFAULT false;

-- Komentarz wyjaśniający
COMMENT ON COLUMN profiles.can_access_ksef_config IS 
'Określa czy użytkownik ma dostęp do zakładki Konfiguracja KSEF. Domyślnie false.';