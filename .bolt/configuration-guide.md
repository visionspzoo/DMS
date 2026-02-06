# Konfiguracja zmiennych środowiskowych

Ten dokument wyjaśnia, jakie zmienne środowiskowe są wymagane do pełnej funkcjonalności aplikacji.

## Zmienne środowiskowe Supabase (automatyczne)

Następujące zmienne są automatycznie skonfigurowane w Supabase Edge Functions:

- `SUPABASE_URL` - URL projektu Supabase
- `SUPABASE_SERVICE_ROLE_KEY` - Klucz service role do operacji backend
- `SUPABASE_ANON_KEY` - Klucz publiczny do operacji frontend

## Zmienne wymagane do OCR (OpenAI)

### OPENAI_API_KEY

Klucz API OpenAI jest wymagany do przetwarzania OCR faktur.

**Jak uzyskać:**
1. Przejdź do https://platform.openai.com/api-keys
2. Zaloguj się lub utwórz konto
3. Kliknij "Create new secret key"
4. Skopiuj wygenerowany klucz (zaczyna się od `sk-`)

**Gdzie skonfigurować:**
W panelu Supabase, w sekcji Edge Functions secrets, dodaj:
- Klucz: `OPENAI_API_KEY`
- Wartość: Twój klucz API OpenAI

**Co się stanie, jeśli nie skonfigurujesz:**
- Przesyłanie faktur będzie działać
- Pliki będą zapisywane w Supabase Storage
- OCR nie będzie działać - dane faktury nie będą automatycznie wypełniane
- Użytkownicy będą musieli ręcznie wprowadzać dane faktury

## Zmienne wymagane do Google Drive

### GOOGLE_CLIENT_ID

ID klienta OAuth 2.0 z Google Cloud Console.

**Jak uzyskać:**
1. Przejdź do https://console.cloud.google.com/
2. Utwórz nowy projekt lub wybierz istniejący
3. Przejdź do "APIs & Services" > "Credentials"
4. Kliknij "Create Credentials" > "OAuth client ID"
5. Wybierz "Web application"
6. Skopiuj "Client ID"

### GOOGLE_CLIENT_SECRET

Sekret klienta OAuth 2.0.

**Jak uzyskać:**
- Ten sekret jest wyświetlany obok Client ID podczas tworzenia OAuth credentials
- Skopiuj "Client secret"

### GOOGLE_REFRESH_TOKEN

Token odświeżania OAuth 2.0.

**Jak uzyskać:**
1. Użyj OAuth 2.0 Playground: https://developers.google.com/oauthplayground/
2. W ustawieniach (ikona koła zębatego) włącz "Use your own OAuth credentials"
3. Wprowadź swój Client ID i Client Secret
4. Wybierz "Drive API v3" > "https://www.googleapis.com/auth/drive.file"
5. Kliknij "Authorize APIs" i zaloguj się
6. Kliknij "Exchange authorization code for tokens"
7. Skopiuj "Refresh token"

### GOOGLE_DRIVE_FOLDER_ID

ID folderu Google Drive, gdzie będą przechowywane faktury.

**Jak uzyskać:**
1. Utwórz folder w Google Drive dla faktur
2. Otwórz folder
3. Skopiuj ID z URL:
   - URL wygląda jak: `https://drive.google.com/drive/folders/ABC123XYZ`
   - ID to część po `/folders/`: `ABC123XYZ`

**Gdzie skonfigurować wszystkie zmienne Google:**
W panelu Supabase, w sekcji Edge Functions secrets, dodaj:
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

**Co się stanie, jeśli nie skonfigurujesz:**
- Przesyłanie faktur będzie działać
- Pliki będą zapisywane tylko w Supabase Storage
- Pliki NIE będą kopiowane do Google Drive
- Organizacja w folderach wg działów nie będzie działać

## Podsumowanie

### Minimalna konfiguracja (tylko przesyłanie plików):
- Brak dodatkowych zmiennych - pliki będą zapisywane w Supabase Storage

### Zalecana konfiguracja (OCR + Storage):
- `OPENAI_API_KEY` - automatyczne wypełnianie danych faktury

### Pełna konfiguracja (OCR + Google Drive):
- `OPENAI_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REFRESH_TOKEN`
- `GOOGLE_DRIVE_FOLDER_ID`

## Testowanie konfiguracji

Po skonfigurowaniu zmiennych:

1. Prześlij fakturę testową
2. Sprawdź console w przeglądarce (F12) - zobaczycie komunikaty o sukcesie/błędzie:
   - `Google Drive upload successful` lub `Google Drive: [error]`
   - `OCR processing successful` lub `OCR: [error]`
3. Sprawdź, czy dane faktury zostały automatycznie wypełnione
4. Sprawdź, czy plik pojawił się w Google Drive (jeśli skonfigurowano)

## Rozwiązywanie problemów

### OCR nie działa
- Sprawdź, czy `OPENAI_API_KEY` jest poprawnie skonfigurowany
- Sprawdź, czy masz środki na koncie OpenAI
- Sprawdź console przeglądarki dla szczegółów błędu

### Google Drive nie działa
- Sprawdź, czy wszystkie 4 zmienne Google są skonfigurowane
- Sprawdź, czy Google Drive API jest włączone w projekcie
- Sprawdź, czy folder o podanym ID istnieje i jest dostępny
- Upewnij się, że refresh token jest ważny

### Faktury się przesyłają ale dane nie są wypełniane
- To normalne zachowanie bez konfiguracji OCR
- Dane można wprowadzić ręcznie klikając "Edytuj" w szczegółach faktury
