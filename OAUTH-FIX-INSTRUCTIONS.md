# Naprawa Problemu z OAuth - Podsumowanie

## Problem
Nowi użytkownicy logowali się przez Google OAuth, ale otrzymywali komunikat:
**"Brak dostępu: Musisz otrzymać zaproszenie aby uzyskać dostęp do systemu"**

## Przyczyna
Trigger `handle_new_user` nie tworzył profili dla nowych użytkowników z powodu **niezgodności nazw ról**:

- **Zaproszenia** (tabela `user_invitations`) używają angielskich nazw: `specialist`, `manager`, `director`, `ceo`
- **Profile** (tabela `profiles`) wymagają polskich nazw: `Specjalista`, `Kierownik`, `Dyrektor`, `CEO`

Gdy trigger próbował skopiować rolę z zaproszenia do profilu, PostgreSQL odrzucał wstawienie przez constraint:
```
CHECK ((role = ANY (ARRAY['CEO'::text, 'Dyrektor'::text, 'Kierownik'::text, 'Specjalista'::text])))
```

## Rozwiązanie

### 1. Dodano Funkcję Mapującą Role
```sql
CREATE FUNCTION map_role_to_polish(english_role text) RETURNS text
```

Funkcja automatycznie przekształca:
- `specialist` → `Specjalista`
- `manager` → `Kierownik`
- `director` → `Dyrektor`
- `ceo` → `CEO`

### 2. Zaktualizowano Trigger
Trigger `on_auth_user_created` teraz:
1. Pobiera zaproszenie dla nowego użytkownika
2. **Mapuje rolę** z angielskiego na polski używając `map_role_to_polish()`
3. Tworzy profil z poprawną polską nazwą roli
4. Oznacza zaproszenie jako "accepted"

### 3. Naprawiono Istniejącego Użytkownika
Użytkownik `p.dudek@auraherbals.pl` który się zalogował przed naprawą otrzymał profil ręcznie.

## Weryfikacja

Wszyscy użytkownicy w systemie mają teraz poprawne profile:

| Email | Rola | Dział |
|-------|------|-------|
| p.dudek@auraherbals.pl | Specjalista | IT |
| j.paul@auraherbals.pl | CEO | Zarząd |
| a.tkaczyk@auraherbals.pl | Dyrektor | Marketing |
| s.hoffman@auraherbals.pl | Kierownik | IT |

## Co Teraz?

### Dla Nowych Użytkowników
1. Administrator wysyła zaproszenie (używa angielskich nazw ról w panelu)
2. Użytkownik loguje się przez Google
3. **Trigger automatycznie tworzy profil** z polską nazwą roli
4. Użytkownik od razu ma dostęp do systemu

### Testowanie
Jeśli chcesz przetestować:
1. Wyślij zaproszenie do nowego użytkownika przez panel **Settings → User Invitations**
2. Zaloguj się jako ten użytkownik (w trybie incognito)
3. Sprawdź czy dashboard się wyświetla bez błędów
4. Ewentualnie użyj narzędzia `test-new-user-oauth.html` do diagnostyki

## Pliki Zmienione
- Migracja: `fix_role_mapping_english_to_polish.sql`
- Dokumentacja: `INSTRUKCJA-NOWI-UZYTKOWNICY.md` (zaktualizowana)
- Ten plik: `OAUTH-FIX-INSTRUCTIONS.md` (zaktualizowany)

## Szczegóły Techniczne

### Naprawione Problemy:
1. ✅ Trigger był typu `INSTEAD OF` → zmieniono na `AFTER INSERT`
2. ✅ Brak polityk RLS dla nowych profili → dodano polityki dla service_role i authenticated
3. ✅ Funkcja mogła być blokowana przez RLS → `SECURITY DEFINER` z pełnymi uprawnieniami
4. ✅ **Niezgodność nazw ról** → dodano funkcję mapującą `map_role_to_polish()`

### Co Jest Chronione:
- Tylko użytkownicy z ważnymi zaproszeniami mogą utworzyć profil
- Zaproszenia wygasają po 7 dniach
- Email musi być z domeny @auraherbals.pl
- Trigger działa tylko dla nowo tworzonych użytkowników (nie nadpisuje istniejących profili)

---

## Jak Przetestować Logowanie

### Krok 1: Upewnij się, że Google OAuth jest włączony w Supabase

1. Przejdź do panelu Supabase: https://mzncjizbhvrqyyzclqxi.supabase.co
2. Kliknij **Authentication** → **Providers**
3. Znajdź **Google** na liście i sprawdź czy jest włączony (przełącznik na zielono)

### Krok 2: Sprawdź Redirect URI w Google Cloud Console

1. Przejdź do: https://console.cloud.google.com/apis/credentials
2. Znajdź swój OAuth 2.0 Client ID
3. Sprawdź czy w **Authorized redirect URIs** jest:
   ```
   https://mzncjizbhvrqyyzclqxi.supabase.co/auth/v1/callback
   ```

### Krok 3: Przetestuj Logowanie

1. Otwórz aplikację w trybie incognito
2. Kliknij **"Zaloguj się przez Google"**
3. Wybierz konto z zaproszeniem (np. nowo zaproszony użytkownik)
4. Po zalogowaniu powinieneś zobaczyć dashboard

## Narzędzie Diagnostyczne

Jeśli nadal występuje problem, otwórz w przeglądarce:
```
test-new-user-oauth.html
```

To narzędzie:
- Sprawdzi czy zaproszenie jest aktywne
- Przetestuje logowanie OAuth
- Sprawdzi czy profil został utworzony przez trigger
- Pokaże szczegółowe informacje debugowania
