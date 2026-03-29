# Dokumentacja Techniczna: Integracja Google Workspace

## Spis treści

1. [Przegląd architektury](#1-przegląd-architektury)
2. [Schemat bazy danych](#2-schemat-bazy-danych)
3. [OAuth 2.0 - Uwierzytelnianie](#3-oauth-20---uwierzytelnianie)
4. [Synchronizacja Gmail (email → faktury)](#4-synchronizacja-gmail)
5. [Synchronizacja Google Drive (drive → faktury)](#5-synchronizacja-google-drive)
6. [Operacje na Google Drive](#6-operacje-na-google-drive)
7. [Edge Functions - przegląd](#7-edge-functions---przegląd)
8. [Bezpieczeństwo i RLS](#8-bezpieczeństwo-i-rls)
9. [Zmienne środowiskowe](#9-zmienne-środowiskowe)
10. [Frontend - panel konfiguracyjny](#10-frontend---panel-konfiguracyjny)

---

## 1. Przegląd architektury

Integracja Google Workspace obsługuje dwa niezależne kanały importu faktur oraz zarządzanie plikami na Google Drive:

```
KANAŁ 1: Gmail → Faktury
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Użytkownik podłącza konto Gmail (OAuth)
            ↓
  Edge Function skanuje skrzynkę Gmail API
            ↓
  Filtr PDF identyfikuje faktury (algorytm lokalny)
            ↓
  Upload do Supabase Storage
            ↓
  Tworzenie rekordu faktury w bazie
            ↓
  Async: OCR + upload do folderu działu na Drive

KANAŁ 2: Google Drive → Faktury
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Użytkownik konfiguruje foldery Drive (OAuth)
            ↓
  Edge Function listuje pliki PDF w folderach
            ↓
  Deduplication → Download → Upload Supabase Storage
            ↓
  Tworzenie rekordu faktury z przypisaniem działu
            ↓
  Async: OCR + przeniesienie do folderu drafts działu

ZARZĄDZANIE PLIKAMI NA DRIVE:
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Upload faktur → Folder draft działu
  Zatwierdzenie → Przeniesienie do folderu unpaid
  Zapłacenie  → Przeniesienie do folderu paid
  Usunięcie   → Usunięcie z Drive
```

---

## 2. Schemat bazy danych

### Tabela: `user_email_configs`

Przechowuje tokeny OAuth dla połączeń Gmail. Każdy użytkownik może mieć wiele konfiguracji email.

```sql
CREATE TABLE user_email_configs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id),
  email_address       text NOT NULL,
  provider            text NOT NULL DEFAULT 'google_workspace',

  -- Pola OAuth (aktywnie używane)
  oauth_access_token  text,           -- Krótkoterminowy token (~1 godzina)
  oauth_refresh_token text,           -- Długoterminowy token do odnowienia
  oauth_token_expiry  timestamptz,    -- Czas wygaśnięcia access tokena

  -- Pola legacy IMAP (nieużywane, do usunięcia)
  imap_server         text,
  imap_port           integer,
  email_username      text,
  email_password      text,

  is_active           boolean DEFAULT true,
  last_sync_at        timestamptz,
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now(),

  UNIQUE(user_id, email_address)
);
```

### Tabela: `user_drive_folder_mappings`

Mapuje foldery Google Drive użytkownika na działy aplikacji. Zastępuje starszą tabelę `user_drive_configs`.

```sql
CREATE TABLE user_drive_folder_mappings (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES profiles(id),
  folder_name              text NOT NULL,           -- Własna nazwa folderu (dla UI)
  google_drive_folder_url  text NOT NULL,           -- Pełny URL folderu Drive
  google_drive_folder_id   text,                   -- Auto-wyciągane z URL triggerem
  department_id            uuid NOT NULL REFERENCES departments(id),
  default_assignee_id      uuid REFERENCES profiles(id), -- Domyślny assignee (opcjonalny)
  is_active                boolean DEFAULT true,
  last_sync_at             timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now()
);

-- Trigger: auto-wyciąga folder ID z URL
-- Przykład URL: https://drive.google.com/drive/folders/1abc2def3ghi4
-- Wyciągnięte ID: 1abc2def3ghi4
```

### Tabela: `user_drive_configs` (legacy)

Starsza tabela - jeden folder per użytkownik bez przypisania do działu. Nadal działa jako fallback gdy brak mappings.

```sql
CREATE TABLE user_drive_configs (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                  uuid NOT NULL REFERENCES profiles(id),
  google_drive_folder_url  text NOT NULL,
  google_drive_folder_id   text,   -- Auto-wyciągane triggerem
  is_active                boolean DEFAULT true,
  last_sync_at             timestamptz,
  created_at               timestamptz DEFAULT now(),
  updated_at               timestamptz DEFAULT now(),
  UNIQUE(user_id)
);
```

### Tabela: `email_sync_jobs`

Śledzi postęp chunked synchronizacji emaili. Umożliwia wznowienie przerwanej synchronizacji.

```sql
CREATE TABLE email_sync_jobs (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id),
  email_config_id     uuid NOT NULL,
  status              text,       -- pending | running | completed | failed
  page_token          text,       -- Token paginacji Gmail do wznowienia
  messages_found      int DEFAULT 0,
  messages_processed  int DEFAULT 0,
  invoices_synced     int DEFAULT 0,
  chunk_size          int DEFAULT 20,
  query               text,       -- Zapytanie Gmail (np. "after:1709251200 has:attachment filename:pdf")
  force_reimport      boolean DEFAULT false,
  date_from           date,
  date_to             date,
  started_at          timestamptz,
  last_chunk_at       timestamptz,  -- Aktualizowane po każdym chunk (timeout detection)
  completed_at        timestamptz,
  error_message       text,
  created_at          timestamptz DEFAULT now()
);
```

**Wykrywanie zawieszonych jobów:** job z `status='running'` i `last_chunk_at < now() - 10 minut` jest uznawany za zawieszony i oznaczany jako `failed`.

### Tabela: `processed_email_messages`

Zapobiega ponownemu przetwarzaniu tych samych wiadomości Gmail.

```sql
CREATE TABLE processed_email_messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_config_id  uuid NOT NULL REFERENCES user_email_configs(id),
  message_uid      text NOT NULL,   -- ID wiadomości z Gmail API
  message_id       text,
  thread_id        text,
  processed_at     timestamptz,
  attachment_count int DEFAULT 0,
  invoice_count    int DEFAULT 0,
  created_at       timestamptz DEFAULT now(),
  UNIQUE(email_config_id, message_uid)
);
```

### Tabela: `processed_email_thread_files`

Deduplikacja załączników PDF na poziomie wątku email. Obsługuje przypadki gdy ten sam PDF pojawia się w odpowiedzi/forwardzie.

```sql
CREATE TABLE processed_email_thread_files (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email_config_id  uuid NOT NULL REFERENCES user_email_configs(id),
  thread_id        text NOT NULL,   -- ID wątku Gmail
  filename         text NOT NULL,
  message_id       text NOT NULL,
  file_size        bigint,
  created_at       timestamptz DEFAULT now(),
  UNIQUE(email_config_id, thread_id, filename)
);
```

### Tabela: `invoice_attachments`

Dodatkowe pliki załączone do faktur (przechowywane na Google Drive).

```sql
CREATE TABLE invoice_attachments (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invoice_id                uuid NOT NULL REFERENCES invoices(id),
  uploaded_by               uuid NOT NULL REFERENCES profiles(id),
  file_name                 text NOT NULL,
  google_drive_file_id      text NOT NULL,
  google_drive_web_view_link text NOT NULL,
  google_drive_folder_id    text,
  mime_type                 text,
  file_size                 bigint,
  created_at                timestamptz DEFAULT now()
);
```

### Kolumny dodane do `invoices`

```sql
-- Pola integracji Drive
ALTER TABLE invoices ADD COLUMN user_drive_file_id   text;       -- ID pliku w Drive użytkownika
ALTER TABLE invoices ADD COLUMN drive_owner_user_id  uuid;       -- Użytkownik którego OAuth jest właścicielem pliku
ALTER TABLE invoices ADD COLUMN google_drive_id      text;       -- ID pliku w folderze działu
ALTER TABLE invoices ADD COLUMN file_hash            text;       -- SHA-256 do deduplikacji
ALTER TABLE invoices ADD COLUMN source               text;       -- email | google_drive | manual
```

### Kolumny dodane do `departments`

```sql
ALTER TABLE departments ADD COLUMN google_drive_draft_folder_id       text;  -- Folder dla nowych faktur (draft)
ALTER TABLE departments ADD COLUMN google_drive_unpaid_folder_id      text;  -- Folder dla zatwierdzonych (do zapłaty)
ALTER TABLE departments ADD COLUMN google_drive_paid_folder_id        text;  -- Folder dla zapłaconych
ALTER TABLE departments ADD COLUMN google_drive_attachments_folder_id text;  -- Folder dla załączników
```

---

## 3. OAuth 2.0 - Uwierzytelnianie

### Przepływ OAuth

```
1. Frontend inicjuje OAuth:
   https://accounts.google.com/o/oauth2/v2/auth
   ?client_id={GOOGLE_CLIENT_ID}
   &redirect_uri={APP_URL}/settings
   &response_type=code
   &scope=https://www.googleapis.com/auth/gmail.readonly
         https://www.googleapis.com/auth/userinfo.email
         https://www.googleapis.com/auth/drive
   &access_type=offline
   &prompt=consent

2. Google przekierowuje z kodem autoryzacji:
   {APP_URL}/settings?code=4/0AbcDef...

3. Frontend wysyła kod do Edge Function:
   POST /functions/v1/google-oauth-callback
   Authorization: Bearer {user_jwt}
   { "code": "4/0AbcDef...", "redirect_uri": "{APP_URL}/settings" }

4. Edge Function wymienia kod na tokeny:
   POST https://oauth2.googleapis.com/token
   code={code}
   &client_id={GOOGLE_CLIENT_ID}
   &client_secret={GOOGLE_CLIENT_SECRET}
   &redirect_uri={redirect_uri}
   &grant_type=authorization_code

   Odpowiedź:
   {
     "access_token": "ya29.a0AfH...",
     "expires_in": 3599,
     "refresh_token": "1//0gHk...",
     "token_type": "Bearer"
   }

5. Pobiera email użytkownika:
   GET https://www.googleapis.com/oauth2/v2/userinfo
   Authorization: Bearer {access_token}

6. Zapisuje do bazy danych:
   INSERT INTO user_email_configs (upsert):
   {
     user_id: auth.uid(),
     email_address: userinfo.email,
     provider: "google_workspace",
     oauth_access_token: access_token,
     oauth_refresh_token: refresh_token,
     oauth_token_expiry: now() + expires_in,
     is_active: true
   }
```

### Odświeżanie tokenów (auto-refresh)

Każda Edge Function która używa Google API wykonuje tę samą logikę przed każdym wywołaniem:

```typescript
async function getValidAccessToken(supabase, config) {
  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  const bufferMs = 5 * 60 * 1000; // 5 minut bufora

  if (Date.now() >= expiryTime - bufferMs) {
    // Token wygasa za mniej niż 5 minut - odśwież
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token: config.oauth_refresh_token,
        grant_type: "refresh_token",
      }),
    });

    const tokens = await response.json();
    const newExpiry = new Date(Date.now() + tokens.expires_in * 1000);

    // Zaktualizuj token w bazie
    await supabase.from("user_email_configs").update({
      oauth_access_token: tokens.access_token,
      oauth_token_expiry: newExpiry.toISOString(),
    }).eq("id", config.id);

    return tokens.access_token;
  }

  return config.oauth_access_token;
}
```

### Uwierzytelnianie Service Account (opcjonalne)

Dla operacji adminowych (gdy `GOOGLE_SERVICE_ACCOUNT_JSON` jest skonfigurowany):

```
1. Parsuj JSON service account (client_email, private_key)

2. Utwórz JWT:
   Header: { "alg": "RS256", "typ": "JWT" }
   Payload: {
     "iss": "service-account@project.iam.gserviceaccount.com",
     "scope": "https://www.googleapis.com/auth/drive",
     "aud": "https://oauth2.googleapis.com/token",
     "iat": now,
     "exp": now + 3600
   }

3. Podpisz RS256 prywatnym kluczem

4. Wymień JWT na access token:
   POST https://oauth2.googleapis.com/token
   { "grant_type": "urn:ietf:params:oauth:grant-type:jwt-bearer", "assertion": jwt }
```

**Priorytet uwierzytelniania w Edge Functions (upload/move/delete):**
1. Service Account (jeśli `GOOGLE_SERVICE_ACCOUNT_JSON` skonfigurowany)
2. Globalny Refresh Token (jeśli `GOOGLE_REFRESH_TOKEN` skonfigurowany)
3. OAuth konkretnego użytkownika (per-user OAuth z `user_email_configs`)

---

## 4. Synchronizacja Gmail

### Edge Function: `sync-user-email-invoices`

#### Tryby wywołania

| Endpoint | Opis |
|----------|------|
| `GET ?diag=1` | Tylko diagnostyka, bez synchronizacji |
| `GET ?stream=1` | Streaming SSE z aktualizacjami postępu |
| `POST` | Standardowa synchronizacja |
| `POST ?resume_chunk=1` | Wznowienie przerwanego joba |

#### Parametry żądania

```json
{
  "force_reimport": false,     // Ignoruj już przetworzone wiadomości
  "date_from": "2024-01-01",   // Opcjonalny zakres dat
  "date_to": "2024-12-31",
  "resume_job_id": "uuid"      // Dla wznowienia
}
```

#### Pełny przepływ synchronizacji

```
1. Autoryzacja:
   - JWT token → user_id
   - Lub SERVICE_ROLE_KEY → user_id z body (dla triggerów cron)

2. Załaduj konfiguracje email:
   SELECT * FROM user_email_configs
   WHERE user_id = ? AND is_active = true AND provider = 'google_workspace'

3. Dla każdej konfiguracji email:

   a. Zarządzanie jobem:
      - Sprawdź czy istnieje aktywny job (pending/running)
      - Jeśli job jest zawieszony (> 10 min bez aktualizacji) → oznacz jako failed
      - Utwórz nowy job lub wznów istniejący

   b. Zbuduj zapytanie Gmail:
      Domyślne (ostatnie 14 dni):
      "after:{timestamp} has:attachment filename:pdf -in:sent"

      Z zakresem dat (force_reimport):
      "after:{date_from} before:{date_to} has:attachment filename:pdf -in:sent"

   c. Listuj wiadomości (chunk po 20):
      GET https://gmail.googleapis.com/gmail/v1/users/me/messages
      ?q={query}
      &maxResults=20
      &pageToken={nextPageToken}

   d. Dla każdej wiadomości:

      i. Pobierz szczegóły:
         GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}
         ?fields=payload,threadId,internalDate

      ii. Wyciągnij:
          - Subject z nagłówków
          - Date z nagłówków lub internalDate
          - Załączniki PDF z parts (rekurencyjnie)

      iii. Dla każdego załącznika PDF:

           SPRAWDŹ ROZMIAR: maks. 1 MB → pomiń większe

           DEDUPLIKACJA (3 poziomy):
           1. Sprawdź file_hash w invoices (ten sam plik juz istnieje)
           2. Sprawdź processed_email_thread_files (filename + thread_id)
           3. Sprawdź processed_email_messages (message_uid)

           POBIERZ ZAŁĄCZNIK:
           GET https://gmail.googleapis.com/gmail/v1/users/me/messages/{id}/attachments/{attachmentId}
           Dane w base64 URL-safe → zdekoduj do binary

           FILTR FAKTUR (lokalny algorytm - patrz sekcja poniżej)
           → jeśli nie jest fakturą → pomiń

           UPLOAD DO SUPABASE STORAGE:
           POST /storage/v1/object/documents/invoices/{fileName}

           UTWÓRZ REKORD FAKTURY:
           INSERT INTO invoices {
             file_url, pdf_base64,
             uploaded_by: userId,
             source: "email",
             file_hash: sha256,
             status: "draft"
           }

           ASYNC: OCR
           POST /functions/v1/process-invoice-ocr
           → wyciąga: invoice_number, supplier_name, gross_amount, issue_date

           ASYNC: Upload na Drive działu
           POST /functions/v1/upload-to-google-drive
           → folder draft działu → podfoldery rok/miesiąc

           ZAPISZ STAN PRZETWARZANIA:
           INSERT INTO processed_email_thread_files
           INSERT INTO processed_email_messages

   e. Aktualizuj job:
      Jeśli jest nextPageToken:
        UPDATE email_sync_jobs SET status='pending', page_token=nextPageToken
        → Zaplanuj next chunk za 2 sekundy (EdgeRuntime.waitUntil)
      Jeśli koniec:
        UPDATE email_sync_jobs SET status='completed'
```

#### Algorytm filtrowania faktur (bez AI)

Lokalny algorytm w 4 krokach - nie wymaga żadnych zewnętrznych API:

```typescript
// KROK 1: Blacklista nazw plików (HARD SKIP)
const BLACKLIST = [
  'newsletter', 'brochure', 'katalog', 'catalog',
  'presentation', 'prezentacja', 'regulamin',
  'terms_and_conditions', 'vendo.erp'
];
// Jeśli filename zawiera jedno z tych słów → pomiń

// KROK 2: Wyciągnij tekst z PDF
// Pierwsza strona (dla sprawdzenia słowa "faktura")
// Cały dokument (dla sprawdzenia kwoty)

// KROK 3: Szukaj słowa oznaczającego fakturę na PIERWSZEJ STRONIE (WYMAGANE)
const INVOICE_WORDS = [
  /\bfaktura\b/i,       // Polski
  /\binvoice\b/i,       // Angielski
  /\brechnung\b/i,      // Niemiecki
  /\bfacture\b/i,       // Francuski
  /\bfattura\b/i,       // Włoski
  /\bfactura\b/i,       // Hiszpański
  /\bnota\s+(?:księgowa|korygująca)\b/i,
  /\bcredit\s+note\b/i,
  /\bproforma\b/i,
];
// Jeśli brak → pomiń

// KROK 4: Szukaj kwoty pieniężnej GDZIEKOLWIEK w dokumencie (WYMAGANE)
const AMOUNT_PATTERNS = [
  /\d[\d\s]*[,.]\d{2}\s*(pln|eur|usd|gbp|chf)/i,  // 1234,56 PLN
  /\d[\d\s]*[,.]\d{2}\s*(zł|€|\$|£)/i,             // 1234,56 zł
  /(pln|eur|zł|€)\s*\d[\d\s]*[,.]\d{2}/i,          // PLN 1234,56
  /\d+[\s\u00a0]?\d{3}[,.]\d{2}/,                  // 1 234,56 (europejski)
];
// Jeśli brak → pomiń

// Wynik: { isInvoice: true, confidence: 1.0, reasons: [...] }
```

#### Streaming SSE (tryb `?stream=1`)

Zwraca Server-Sent Events z aktualizacjami w czasie rzeczywistym:

```
event: account_start
data: {"email": "user@company.com"}

event: messages_found
data: {"count": 45}

event: processing_attachment
data: {"filename": "faktura_01_2024.pdf", "messageId": "..."}

event: invoice_created
data: {"invoiceId": "uuid", "filename": "faktura_01_2024.pdf"}

event: attachment_skipped
data: {"filename": "katalog.pdf", "reason": "filename blacklist"}

event: ocr_done
data: {"invoiceId": "uuid", "invoiceNumber": "FV/2024/001"}

event: done
data: {"total": 45, "synced": 12, "skipped": 33}
```

---

## 5. Synchronizacja Google Drive

### Edge Function: `sync-user-drive-invoices`

#### Przepływ synchronizacji

```
1. Załaduj mapowania folderów:
   SELECT * FROM user_drive_folder_mappings
   WHERE user_id = ? AND is_active = true
   ORDER BY created_at

   (Fallback: SELECT * FROM user_drive_configs WHERE user_id = ?)

2. Dla każdego mapowania folderu:

   a. Pobierz ważny token OAuth (z auto-refresh)

   b. Określ assignee (kto będzie właścicielem faktury):
      Priorytet:
      1. default_assignee_id z mapowania folderu
      2. manager_id z powiązanego działu
      3. director_id działu
      4. Aktualny użytkownik (fallback)

   c. Listuj pliki PDF w folderze Drive:
      GET https://www.googleapis.com/drive/v3/files
      ?q='{folderId}' in parents
           and mimeType='application/pdf'
           and trashed=false
      &fields=files(id,name,modifiedTime,size)
      &pageSize=50

   d. Dla każdego pliku PDF:

      DEDUPLIKACJA:
      - Sprawdź invoices WHERE file_hash = 'drive:{fileId}'
      - Sprawdź invoices WHERE invoice_number = filename (bez .pdf)
      → Pomiń jeśli już istnieje

      POBIERZ PLIK:
      GET https://www.googleapis.com/drive/v3/files/{fileId}?alt=media
      Authorization: Bearer {access_token}

      Oblicz SHA-256 hash

      UPLOAD DO SUPABASE STORAGE:
      Ścieżka: invoices/{userId}/{timestamp}_{filename}

      UTWÓRZ REKORD FAKTURY:
      INSERT INTO invoices {
        invoice_number: filename (bez .pdf),
        uploaded_by: assigneeId,
        department_id: mapping.department_id,
        status: "draft",
        pdf_base64: base64Content,
        file_url: storageUrl,
        source: "google_drive",
        file_hash: "drive:{fileId}",    ← prefix "drive:" odróżnia od hash SHA-256
        user_drive_file_id: fileId,
        drive_owner_user_id: currentUserId
      }

      ASYNC: OCR
      POST /functions/v1/process-invoice-ocr

      ASYNC: Przenieś do folderu draft działu
      Jeśli department.google_drive_draft_folder_id istnieje:
        POST /functions/v1/upload-to-google-drive
        → Nowy plik w folderze drafts działu
        → Podfolderery rok/miesiąc
        → Usuń stary plik z folderu użytkownika
        → Zaktualizuj user_drive_file_id w invoices

   e. Zaktualizuj last_sync_at:
      UPDATE user_drive_folder_mappings SET last_sync_at = now()

3. Zwróć podsumowanie:
   {
     "message": "Zsynchronizowano 5 faktur z Google Drive",
     "total_synced": 5,
     "errors": [],
     "warnings": []
   }
```

---

## 6. Operacje na Google Drive

### Upload pliku (`upload-to-google-drive`)

```
Dane wejściowe:
{
  "fileBase64": "...",
  "fileName": "FV_2024_001_Firma_ABC.pdf",
  "folderId": "folder_id_lub_url",
  "invoiceId": "uuid",           // opcjonalne - do aktualizacji rekordu
  "issueDate": "2024-03-15"      // opcjonalne - do tworzenia podfolderów rok/miesiąc
}

Proces:
1. Wyciągnij folder ID z URL jeśli potrzeba
   Regex: /folders/([a-zA-Z0-9_-]+)

2. Jeśli issueDate podane → utwórz podfoldery:
   Rok: "2024"
   Miesiąc: "03 - Marzec"
   (szukaj istniejących lub utwórz nowe)

3. Zbuduj nazwę pliku:
   Format: "{invoice_number}_{supplier_name}.pdf"
   Sanitize: zastąp /\/:*?"<>|/ znakiem _

4. Upload multipart do Drive API:
   POST https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart

   --boundary
   Content-Type: application/json
   { "name": "nazwa.pdf", "mimeType": "application/pdf", "parents": ["folderId"] }

   --boundary
   Content-Type: application/pdf
   {binary PDF content}

5. Jeśli invoiceId podane → zaktualizuj rekord:
   UPDATE invoices SET google_drive_id = fileId, user_drive_file_id = fileId
   WHERE id = invoiceId
```

### Przeniesienie pliku (`move-file-on-google-drive`)

```
Dane wejściowe:
{
  "fileId": "google-drive-file-id",
  "targetFolderId": "folder-id-lub-url",
  "issueDate": "2024-03-25",     // opcjonalne
  "invoiceNumber": "FV/2024/01",
  "vendorName": "Firma ABC"
}

Proces:
1. Wyciągnij folder ID z URL jeśli URL podany
2. Jeśli issueDate → znajdź/utwórz podfoldery rok/miesiąc
3. Pobierz aktualne parents pliku:
   GET https://www.googleapis.com/drive/v3/files/{fileId}?fields=parents
4. Przenieś plik (i opcjonalnie zmień nazwę):
   PATCH https://www.googleapis.com/drive/v3/files/{fileId}
   ?addParents={targetFolderId}&removeParents={oldParents}
   Body: { "name": "{number} - {vendor}.pdf" }
```

### Usunięcie pliku (`delete-from-google-drive`)

```
Dane wejściowe:
{
  "fileId": "google-drive-file-id",
  "ownerUserId": "uuid"  // opcjonalne - czyje OAuth użyć
}

Proces:
1. Wybierz kredentiale (priorytet jak wyżej: SA → globalny token → per-user OAuth)
2. Usuń plik:
   DELETE https://www.googleapis.com/drive/v3/files/{fileId}
   (404 traktowany jako sukces - plik już usunięty)
```

### Bulk upload (`bulk-upload-to-drive`)

Batch upload istniejących faktur na Drive (tylko admin):

```
Dane wejściowe:
{
  "dry_run": false,        // Preview bez uploadu
  "only_missing": true,    // Tylko faktury bez google_drive_id
  "batch_size": 5,         // Ile na raz
  "offset": 0              // Paginacja
}

Logika wyboru folderu docelowego na podstawie statusu faktury:
  draft    → department.google_drive_draft_folder_id
  accepted → department.google_drive_unpaid_folder_id
  paid     → department.google_drive_paid_folder_id
  + podfoldery rok/miesiąc na podstawie issue_date
```

---

## 7. Edge Functions - przegląd

| Funkcja | Opis | Autoryzacja |
|---------|------|-------------|
| `google-oauth-callback` | Wymienia kod OAuth na tokeny | JWT użytkownika |
| `check-oauth-status` | Diagnostyka - sprawdza status połączeń | JWT użytkownika |
| `sync-user-email-invoices` | Sync faktur z Gmail | JWT lub Service Role |
| `sync-user-drive-invoices` | Sync faktur z Drive | JWT lub Service Role |
| `upload-to-google-drive` | Upload pliku PDF na Drive | JWT |
| `bulk-upload-to-drive` | Batch upload (admin) | JWT (admin only) |
| `move-file-on-google-drive` | Przeniesienie pliku w Drive | JWT |
| `delete-from-google-drive` | Usunięcie pliku z Drive | JWT |
| `get-pdf` | Pobieranie PDF z Drive przez API | JWT lub API Token |
| `upload-invoice-attachment` | Upload dodatkowego załącznika | JWT |
| `auto-upload-ksef-pdfs` | Auto-upload PDFs z KSeF | Service Role |
| `retry-drive-upload` | Ponowienie nieudanego uploadu | JWT |

---

## 8. Bezpieczeństwo i RLS

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `user_email_configs` | Własne rekordy | Własne | Własne | Własne |
| `user_drive_configs` | Własne + Admin widzi wszystkie | Własne | Własne | Własne |
| `user_drive_folder_mappings` | Własne + Admin widzi wszystkie | Własne (wymagany dostęp do działu) | Własne | Własne |
| `email_sync_jobs` | Własne | Własne | Własne | - |
| `processed_email_messages` | Własne | Service Role | - | - |
| `processed_email_thread_files` | Własne | Własne + Service Role | - | - |
| `invoice_attachments` | Authenticated | Własne | - | Własny lub Admin |

**Kluczowe zasady bezpieczeństwa:**

- Tokeny OAuth przechowywane w bazie - dostęp tylko przez Service Role lub właściciela
- Refresh token nigdy nie jest zwracany do frontendu po zapisie
- Walidacja: `default_assignee_id` musi należeć do tego samego działu co mapowanie (trigger SQL)
- Wszystkie Edge Functions weryfikują JWT przed wykonaniem operacji
- Service Role używany tylko przez triggery i funkcje cron

---

## 9. Zmienne środowiskowe

### Wymagane

```bash
SUPABASE_URL                  # URL projektu Supabase
SUPABASE_SERVICE_ROLE_KEY     # Service Role klucz API
SUPABASE_ANON_KEY             # Anon/public klucz API
GOOGLE_CLIENT_ID              # OAuth Client ID z Google Cloud Console
GOOGLE_CLIENT_SECRET          # OAuth Client Secret
```

### Opcjonalne (dla operacji adminowych)

```bash
GOOGLE_SERVICE_ACCOUNT_JSON   # JSON Service Account (full Drive access)
GOOGLE_REFRESH_TOKEN          # Globalny refresh token (alternatywa dla SA)
GOOGLE_DRIVE_FOLDER_ID        # Domyślny folder root Drive
```

### Konfiguracja OAuth w Google Cloud Console

Wymagane zakresy (scopes):
```
https://www.googleapis.com/auth/gmail.readonly
https://www.googleapis.com/auth/userinfo.email
https://www.googleapis.com/auth/drive
```

Authorized redirect URIs:
```
{APP_URL}/settings
{SUPABASE_URL}/functions/v1/google-oauth-callback
```

---

## 10. Frontend - panel konfiguracyjny

Plik: `src/components/Configuration/GmailWorkspaceConfig.tsx`

### Sekcja: Połączenie Gmail

- Przycisk "Połącz z Google" → inicjuje OAuth flow
- Lista podłączonych kont z datą ostatniej synchronizacji
- Przycisk odłączenia konta

### Sekcja: Synchronizacja emaili

- Przycisk "Synchronizuj teraz" → wywołuje `sync-user-email-invoices`
- Tryb streaming SSE z paskiem postępu w czasie rzeczywistym
- Opcja "Reimport" z wyborem zakresu dat
- Panel diagnostyki (sprawdza tokeny i konfigurację)

### Sekcja: Mapowania folderów Drive

- Lista skonfigurowanych mapowań (folder → dział)
- Formularz dodawania: URL folderu Drive, wybór działu, opcjonalny domyślny assignee
- Przycisk "Synchronizuj" per folder
- Przycisk usunięcia mapowania

### Sekcja: Ustawienia zaawansowane

- Sprawdź status OAuth (`check-oauth-status`)
- Retry nieudanych uploadów Drive (`retry-drive-upload`)
- Bulk upload istniejących faktur (admin)

---

## Podsumowanie end-to-end

```
SETUP:
1. Admin konfiguruje GOOGLE_CLIENT_ID i GOOGLE_CLIENT_SECRET w Supabase Secrets
2. Admin konfiguruje foldery Drive w ustawieniach działu (draft/unpaid/paid)
3. Użytkownik łączy konto Gmail/Drive przez OAuth

SYNC EMAIL:
1. Użytkownik klika "Synchronizuj" lub cron uruchamia sync automatycznie
2. Gmail API skanuje skrzynkę (ostatnie 14 dni domyślnie)
3. Każdy PDF jest sprawdzany lokalnym filtrem faktur
4. Faktury trafiają do bazy, OCR wyciąga dane, plik ląduje na Drive działu

SYNC DRIVE:
1. Użytkownik klika "Synchronizuj" dla wybranego folderu
2. Drive API listuje pliki PDF w skonfigurowanym folderze
3. Nowe pliki są importowane jako faktury draft
4. Pliki przenoszone do folderu draft działu z podfolderami rok/miesiąc

CYKL ŻYCIA PLIKU NA DRIVE:
  Import → {dział}/draft/2024/03/FV_001_Firma.pdf
  Zatwierdzenie → {dział}/unpaid/2024/03/FV_001_Firma.pdf
  Zapłacenie → {dział}/paid/2024/03/FV_001_Firma.pdf
  Usunięcie faktury → plik usuwany z Drive
```
