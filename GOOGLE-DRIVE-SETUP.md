# Konfiguracja Google Drive dla Supabase Edge Functions

## Problem
Funkcja `upload-to-google-drive` wymaga credentials do Google Drive API.

## Wymagane zmienne środowiskowe

Musisz skonfigurować następujące secrets w Supabase:

1. `GOOGLE_CLIENT_ID` - ID klienta z Google Cloud Console
2. `GOOGLE_CLIENT_SECRET` - Secret klienta z Google Cloud Console
3. `GOOGLE_REFRESH_TOKEN` - Token odświeżania OAuth 2.0

## Krok 1: Utwórz projekt w Google Cloud Console

1. Przejdź do [Google Cloud Console](https://console.cloud.google.com/)
2. Utwórz nowy projekt lub wybierz istniejący
3. Włącz **Google Drive API**:
   - Przejdź do "APIs & Services" → "Enable APIs and Services"
   - Wyszukaj "Google Drive API"
   - Kliknij "Enable"

## Krok 2: Utwórz OAuth 2.0 Credentials

1. Przejdź do "APIs & Services" → "Credentials"
2. Kliknij "Create Credentials" → "OAuth client ID"
3. Wybierz "Web application"
4. Dodaj redirect URI: `https://developers.google.com/oauthplayground`
5. Zapisz **Client ID** i **Client Secret**

## Krok 3: Wygeneruj Refresh Token

1. Przejdź do [OAuth 2.0 Playground](https://developers.google.com/oauthplayground)
2. Kliknij ikonę ustawień (prawy górny róg)
3. Zaznacz "Use your own OAuth credentials"
4. Wprowadź swój Client ID i Client Secret
5. W lewym panelu wybierz "Drive API v3" → zaznacz:
   - `https://www.googleapis.com/auth/drive`
   - `https://www.googleapis.com/auth/drive.file`
6. Kliknij "Authorize APIs"
7. Zaloguj się kontem Google, które będzie używane do uploadu plików
8. Kliknij "Exchange authorization code for tokens"
9. Skopiuj **Refresh token**

## Krok 4: Ustaw secrets w Supabase

1. Przejdź do dashboard Supabase
2. Wybierz swój projekt
3. Przejdź do "Edge Functions" → "Secrets"
4. Dodaj następujące secrets:
   - Nazwa: `GOOGLE_CLIENT_ID`, Wartość: [Twój Client ID]
   - Nazwa: `GOOGLE_CLIENT_SECRET`, Wartość: [Twój Client Secret]
   - Nazwa: `GOOGLE_REFRESH_TOKEN`, Wartość: [Twój Refresh Token]
5. Zapisz

## Krok 5: Upewnij się że foldery są skonfigurowane

W tabeli `departments` każdy dział musi mieć ustawione:
- `google_drive_draft_folder_id` - ID folderu dla faktur roboczych (niesklasyfikowanych)
- `google_drive_unpaid_folder_id` - ID folderu dla nieopłaconych faktur
- `google_drive_paid_folder_id` - ID folderu dla opłaconych faktur

ID folderu to część URL Google Drive po `/folders/`:
```
https://drive.google.com/drive/folders/ABC123XYZ
                                        ^^^^^^^^^^
                                        To jest ID
```

**Przepływ pracy:**
1. Faktury z KSeF → trafiają do folderu "Robocze" (`google_drive_draft_folder_id`)
2. Po zaakceptowaniu → przenoszone do folderu "Nieopłacone" (`google_drive_unpaid_folder_id`)
3. Po oznaczeniu jako opłacone → przenoszone do folderu "Opłacone" (`google_drive_paid_folder_id`)

## Testowanie

Po skonfigurowaniu wszystkich zmiennych, spróbuj ponownie przenieść fakturę z KSEF do działu.
