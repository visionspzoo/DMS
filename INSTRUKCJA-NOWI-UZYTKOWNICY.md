# Instrukcja: Logowanie Nowych Użytkowników przez OAuth

## Co Zostało Naprawione

### 1. Trigger `on_auth_user_created`
- **Problem:** Trigger był typu `INSTEAD OF` zamiast `AFTER INSERT`
- **Rozwiązanie:** Przebudowano trigger jako `AFTER INSERT` który działa po utworzeniu użytkownika w `auth.users`

### 2. Polityki RLS dla Tabeli `profiles`
- **Problem:** Istniejąca polityka wymagała żeby użytkownik był adminem PRZED utworzeniem profilu
- **Rozwiązanie:** Dodano nowe polityki:
  - `Service role can insert profiles` - dla service_role (triggery)
  - `Users can create own profile during signup` - dla nowych użytkowników

### 3. Funkcja `handle_new_user()`
- **Problem:** Funkcja mogła być blokowana przez RLS
- **Rozwiązanie:** Funkcja działa jako `SECURITY DEFINER` z pełnymi uprawnieniami

## Jak Działa Proces Logowania

### Krok 1: Administrator Wysyła Zaproszenie
1. Admin loguje się do systemu
2. Przechodzi do **Settings → User Invitations**
3. Wypełnia formularz:
   - Email użytkownika (musi być z domeny @auraherbals.pl)
   - Rola (specialist, manager, director, ceo)
   - Dział
4. Klika **"Wyślij Zaproszenie"**
5. Email z zaproszeniem jest wysyłany do użytkownika

### Krok 2: Użytkownik Otrzymuje Email
Email zawiera:
- Link do aplikacji
- Informacje o przydzielonej roli i dziale
- Instrukcje logowania

### Krok 3: Użytkownik Loguje Się przez Google
1. Użytkownik otwiera aplikację
2. Klika **"Zaloguj się przez Google"**
3. Wybiera swoje konto Google Workspace (@auraherbals.pl)
4. Autoryzuje aplikację

### Krok 4: Automatyczne Tworzenie Profilu
1. Po autoryzacji Google, użytkownik jest tworzony w `auth.users`
2. **Trigger `on_auth_user_created` automatycznie:**
   - Sprawdza czy istnieje ważne zaproszenie dla tego email
   - Tworzy profil w tabeli `profiles` z odpowiednią rolą i działem
   - Oznacza zaproszenie jako "accepted"
3. Użytkownik jest przekierowywany do aplikacji

### Krok 5: Użytkownik Ma Dostęp
Użytkownik widzi dashboard zgodnie z swoją rolą:
- **Specialist** - może przeglądać faktury swojego działu
- **Manager** - może zatwierdzać faktury w swoim dziale
- **Director** - może zarządzać działem i zatwierdzać faktury
- **CEO** - ma dostęp do wszystkich działów

## Testowanie

### Narzędzie Testowe
Otwórz w przeglądarce: `test-new-user-oauth.html`

To narzędzie pozwoli:
- Sprawdzić czy zaproszenie jest aktywne
- Przetestować logowanie OAuth
- Sprawdzić czy profil został utworzony przez trigger
- Zdiagnozować problemy

### Test Manualny

1. **Upewnij się że Google OAuth jest włączony:**
   - Przejdź do Supabase Dashboard
   - Authentication → Providers → Google
   - Sprawdź czy przełącznik jest zielony

2. **Sprawdź Redirect URI w Google Cloud Console:**
   - https://console.cloud.google.com/apis/credentials
   - W "Authorized redirect URIs" powinien być:
     ```
     https://mzncjizbhvrqyyzclqxi.supabase.co/auth/v1/callback
     ```

3. **Wyślij Zaproszenie:**
   ```sql
   -- W SQL Editor Supabase:
   SELECT email, role, status, expires_at
   FROM user_invitations
   WHERE email = 'test@auraherbals.pl';
   ```
   - Jeśli status = 'pending' i expires_at > NOW() → OK
   - Jeśli nie, wyślij nowe zaproszenie przez panel Settings

4. **Zaloguj się jako nowy użytkownik:**
   - Otwórz aplikację w trybie incognito
   - Kliknij "Zaloguj się przez Google"
   - Wybierz konto test@auraherbals.pl
   - Po przekierowaniu sprawdź czy widzisz dashboard

5. **Sprawdź czy profil został utworzony:**
   ```sql
   -- W SQL Editor Supabase:
   SELECT p.email, p.role, p.full_name, d.name as department
   FROM profiles p
   LEFT JOIN departments d ON d.id = p.department_id
   WHERE p.email = 'test@auraherbals.pl';
   ```

## Możliwe Problemy i Rozwiązania

### Problem: "Google OAuth nie jest skonfigurowany"
**Przyczyna:** Google Provider nie jest włączony w Supabase

**Rozwiązanie:**
1. Supabase Dashboard → Authentication → Providers
2. Znajdź "Google" i włącz
3. Dodaj Client ID i Client Secret z Google Cloud Console

### Problem: "redirect_uri_mismatch"
**Przyczyna:** Niepoprawny Redirect URI w Google Cloud Console

**Rozwiązanie:**
1. Google Cloud Console → APIs & Services → Credentials
2. Edytuj OAuth 2.0 Client ID
3. W "Authorized redirect URIs" dodaj:
   ```
   https://mzncjizbhvrqyyzclqxi.supabase.co/auth/v1/callback
   ```

### Problem: "No valid invitation found"
**Przyczyna:** Brak aktywnego zaproszenia lub zaproszenie wygasło

**Rozwiązanie:**
1. Sprawdź w SQL czy zaproszenie istnieje:
   ```sql
   SELECT * FROM user_invitations
   WHERE email = 'user@auraherbals.pl'
   AND status = 'pending';
   ```
2. Jeśli nie istnieje lub wygasło, wyślij nowe przez Settings → User Invitations

### Problem: Użytkownik się zalogował ale nie widzi dashboardu
**Przyczyna:** Profil nie został utworzony przez trigger

**Rozwiązanie:**
1. Sprawdź czy profil istnieje:
   ```sql
   SELECT * FROM profiles WHERE email = 'user@auraherbals.pl';
   ```
2. Jeśli nie, sprawdź logi triggera w Supabase Dashboard → Database → Logs
3. Jeśli trigger nie zadziałał, ręcznie utwórz profil:
   ```sql
   INSERT INTO profiles (id, email, full_name, role, department_id)
   SELECT
     u.id,
     u.email,
     COALESCE(u.raw_user_meta_data->>'name', u.email),
     i.role,
     i.department_id
   FROM auth.users u
   JOIN user_invitations i ON LOWER(i.email) = LOWER(u.email)
   WHERE u.email = 'user@auraherbals.pl'
   AND i.status = 'pending';

   -- Oznacz zaproszenie jako accepted
   UPDATE user_invitations
   SET status = 'accepted', accepted_at = NOW()
   WHERE email = 'user@auraherbals.pl';
   ```

### Problem: "Database error saving new user"
**Przyczyna:** Problem z uprawnieniami RLS lub błąd w danych

**Rozwiązanie:**
1. Sprawdź logi w Supabase Dashboard → Database → Logs
2. Szukaj komunikatów z `handle_new_user`
3. Jeśli błąd dotyczy RLS, sprawdź polityki:
   ```sql
   SELECT * FROM pg_policies WHERE tablename = 'profiles';
   ```

## Sprawdzanie Statusu Systemu

### Sprawdź czy trigger jest aktywny:
```sql
SELECT
    t.tgname as trigger_name,
    c.relname as table_name,
    CASE t.tgenabled
        WHEN 'O' THEN 'enabled'
        WHEN 'D' THEN 'disabled'
    END as status
FROM pg_trigger t
JOIN pg_class c ON t.tgrelid = c.oid
JOIN pg_namespace n ON c.relnamespace = n.oid
WHERE t.tgname = 'on_auth_user_created'
  AND n.nspname = 'auth';
```

### Sprawdź polityki RLS:
```sql
SELECT policyname, cmd, roles, with_check
FROM pg_policies
WHERE tablename = 'profiles'
  AND cmd = 'INSERT';
```

### Sprawdź aktywne zaproszenia:
```sql
SELECT
    email,
    role,
    status,
    (SELECT name FROM departments WHERE id = user_invitations.department_id) as department,
    expires_at,
    expires_at > NOW() as is_valid
FROM user_invitations
WHERE status = 'pending'
ORDER BY created_at DESC;
```

## Kontakt z Administratorem

Jeśli problem nadal występuje:
1. Zapisz dokładny komunikat błędu
2. Sprawdź logi w konsoli przeglądarki (F12 → Console)
3. Uruchom narzędzie testowe `test-new-user-oauth.html` i zapisz wyniki
4. Skontaktuj się z administratorem systemu z powyższymi informacjami
