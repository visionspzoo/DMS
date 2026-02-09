# Naprawiono Problem z Logowaniem OAuth

## Co Zostało Naprawione

Brakujący trigger `on_auth_user_created` został utworzony. Ten trigger jest odpowiedzialny za automatyczne tworzenie profilu użytkownika po zalogowaniu przez Google OAuth.

## Jak Przetestować Logowanie

### Krok 1: Upewnij się, że Google OAuth jest włączony w Supabase

1. Przejdź do panelu Supabase: https://mzncjizbhvrqyyzclqxi.supabase.co
2. Kliknij **Authentication** → **Providers**
3. Znajdź **Google** na liście i sprawdź czy jest włączony (przełącznik na zielono)
4. Jeśli jest wyłączony:
   - Włącz go
   - Dodaj **Client ID** i **Client Secret** z Google Cloud Console
   - W sekcji **Redirect URL** powinien być: `https://mzncjizbhvrqyyzclqxi.supabase.co/auth/v1/callback`

### Krok 2: Sprawdź Konfigurację w Google Cloud Console

1. Przejdź do: https://console.cloud.google.com/apis/credentials
2. Znajdź swój OAuth 2.0 Client ID
3. Sprawdź czy w **Authorized redirect URIs** jest:
   - `https://mzncjizbhvrqyyzclqxi.supabase.co/auth/v1/callback`
4. Sprawdź czy w **Authorized JavaScript origins** jest:
   - Twoja domena aplikacji (np. `https://twoja-domena.com`)
   - `http://localhost:5173` (do testowania lokalnie)

### Krok 3: Przetestuj Logowanie

1. Otwórz aplikację
2. Kliknij **"Zaloguj się przez Google"**
3. Wybierz konto: `k.majcherski@auraherbals.pl` lub `a.renk@auraherbals.pl`
4. Po zalogowaniu powinieneś zostać przekierowany do aplikacji

## Narzędzie Diagnostyczne

Jeśli nadal występuje problem, otwórz w przeglądarce:
```
http://localhost:5173/test-oauth-debug.html
```

To narzędzie:
- Pokaże dokładny błąd OAuth jeśli taki wystąpi
- Sprawdzi czy sesja została utworzona
- Sprawdzi czy profil został utworzony przez trigger
- Sprawdzi czy zaproszenie jest ważne

## Możliwe Błędy i Rozwiązania

### Błąd: "Google OAuth nie jest skonfigurowany w Supabase"
**Rozwiązanie:** Włącz Google Provider w panelu Supabase (Authentication → Providers)

### Błąd: "redirect_uri_mismatch"
**Rozwiązanie:** Dodaj poprawny redirect URI w Google Cloud Console (zobacz Krok 2)

### Błąd: "No valid invitation found"
**Rozwiązanie:** Sprawdź czy zaproszenie jest nadal ważne (wygasają po 7 dniach). Jeśli wygasło, wyślij nowe zaproszenie.

### Logowanie działa, ale użytkownik nie widzi żadnych danych
**Rozwiązanie:** Sprawdź czy użytkownik ma przypisany dział i odpowiednią rolę w panelu Settings → User Invitations

## Sprawdź Logi

Aby sprawdzić logi triggera:

1. Przejdź do panelu Supabase
2. Kliknij **Database** → **Logs**
3. Filtruj po "handle_new_user"
4. Sprawdź czy pojawiają się błędy

## Aktualne Zaproszenia

Zaproszenia są ważne dla:
- `k.majcherski@auraherbals.pl` - Director, Dział Sprzedaży
- `a.renk@auraherbals.pl` - Manager, Dział Marketingu

Zaproszenia wygasają: **15 lutego 2026**
