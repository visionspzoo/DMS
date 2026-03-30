# Dokumentacja API: Wnioski Zakupowe i Faktury dla Systemów Zewnętrznych

## Spis treści

1. [Przegląd integracji](#1-przegląd-integracji)
2. [System tokenów API](#2-system-tokenów-api)
3. [API Wniosków Zakupowych (Proformy)](#3-api-wniosków-zakupowych-proformy)
4. [API Eksportu Faktur](#4-api-eksportu-faktur)
5. [Aktualizacje zwrotne statusów](#5-aktualizacje-zwrotne-statusów)
6. [Schemat bazy danych](#6-schemat-bazy-danych)
7. [Przepływ akceptacji wniosku](#7-przepływ-akceptacji-wniosku)
8. [Powiadomienia](#8-powiadomienia)
9. [Obsługa błędów](#9-obsługa-błędów)

---

## 1. Przegląd integracji

System udostępnia dwa niezależne REST API dla systemów zewnętrznych:

```
SYSTEM ZEWNĘTRZNY
       │
       ├──► GET  /purchase-requests-api/proforma        → Lista wniosków zakupowych (proformy)
       ├──► GET  /purchase-requests-api/proforma/{id}   → Szczegóły wniosku
       ├──► POST /purchase-requests-api/proforma/{id}/mark-paid  → Oznacz jako zapłacony
       │
       ├──► GET  /invoices-export-api/invoices           → Lista faktur
       └──► POST /invoices-export-api/invoices/{nr}/mark-paid    → Oznacz fakturę jako zapłaconą

AKTUALIZACJE ZWROTNE (webhooks przychodzące):
       │
       └──► POST /clickup-webhook    ← ClickUp wysyła zmianę statusu zadania
```

**Uwierzytelnianie:** Wszystkie endpointy wymagają tokenu API w nagłówku `Authorization: Bearer aurs_...`.

**Base URL:**
```
https://{SUPABASE_URL}/functions/v1
```

---

## 2. System tokenów API

### Generowanie tokenu

Tokeny są generowane w aplikacji w sekcji **Ustawienia → API**. Każdy token:

- Zaczyna się od prefiksu `aurs_`
- Składa się z prefiksu + 64 znaków hex (SHA-256 32 bajtów)
- Jest pokazywany **tylko raz** po wygenerowaniu - należy go od razu skopiować
- W bazie danych przechowywany jest wyłącznie hash SHA-256 (nigdy plaintext)

```
Przykładowy token: aurs_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2
```

### Schemat tabeli `api_tokens`

```sql
CREATE TABLE api_tokens (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id      uuid NOT NULL REFERENCES auth.users(id),
  token_hash   text UNIQUE NOT NULL,     -- SHA-256 hash tokenu
  token_prefix text,                    -- Pierwsze 12 znaków + "..." (do wyświetlania w UI)
  name         text,                    -- Nazwa nadana przez użytkownika
  is_active    boolean DEFAULT true,
  last_used_at timestamptz,             -- Aktualizowane przy każdym użyciu
  expires_at   timestamptz,             -- Opcjonalna data wygaśnięcia
  created_at   timestamptz DEFAULT now()
);
```

### Mechanizm weryfikacji tokenu

```
1. Zewnętrzny system wysyła:
   Authorization: Bearer aurs_a1b2c3d4...

2. Edge Function:
   a. Wyciąga token z nagłówka
   b. Weryfikuje prefix "aurs_"
   c. Oblicza SHA-256(token)
   d. Szuka w api_tokens WHERE token_hash = sha256(token)
   e. Sprawdza: is_active = true
   f. Sprawdza: expires_at IS NULL OR expires_at > now()
   g. Aktualizuje last_used_at = now()
   h. Zwraca user_id powiązany z tokenem

3. Jeśli token nieprawidłowy → HTTP 401
```

### Zarządzanie tokenami (UI)

W panelu **Ustawienia → API** administrator może:
- Tworzyć nowe tokeny z opcjonalną datą wygaśnięcia
- Dezaktywować (unieważniać) istniejące tokeny
- Podglądać: prefix tokenu, datę ostatniego użycia, status aktywny/nieaktywny

---

## 3. API Wniosków Zakupowych (Proformy)

Wniosek zakupowy oznaczony jako proforma to taki, który zawiera plik PDF (`proforma_pdf_base64 IS NOT NULL`). To są wnioski wymagające zapłaty i obsługi przez systemy zewnętrzne (np. ERP, systemy finansowe).

### 3.1 Pobieranie listy proform

```
GET /functions/v1/purchase-requests-api/proforma
Authorization: Bearer aurs_...
```

#### Parametry zapytania

| Parametr | Typ | Domyślnie | Maks. | Opis |
|----------|-----|-----------|-------|------|
| `status` | string | `approved` | - | Przecinkami: `pending`, `approved`, `rejected`, `paid` |
| `from_date` | string | - | - | Format `YYYY-MM-DD`, filtruje po `created_at >=` |
| `to_date` | string | - | - | Format `YYYY-MM-DD`, filtruje po `created_at <=` |
| `limit` | integer | `100` | `500` | Ilość rekordów na stronie |
| `offset` | integer | `0` | - | Offset paginacji |
| `include_pdf` | boolean | `false` | - | Dołącz `proforma_pdf_base64` do odpowiedzi |

#### Przykładowe żądanie

```bash
curl -H "Authorization: Bearer aurs_..." \
  "https://{SUPABASE_URL}/functions/v1/purchase-requests-api/proforma?status=approved&include_pdf=true&limit=50"
```

#### Odpowiedź (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
      "description": "Zakup serwera Dell PowerEdge R750",
      "delivery_location": "Botaniczna",
      "priority": "wysoki",
      "status": "approved",
      "gross_amount": 45000.00,
      "quantity": 1,
      "link": "https://sklep.example.com/serwer",
      "paid_at": null,
      "created_at": "2026-03-01T10:00:00Z",
      "updated_at": "2026-03-02T12:00:00Z",
      "proforma_filename": "proforma_serwer_dell.pdf",
      "proforma_pdf_base64": "JVBERi0xLjQ...",
      "department": {
        "id": "dept-uuid",
        "name": "IT",
        "mpk_code": "MPK-010"
      },
      "submitter": {
        "id": "user-uuid",
        "full_name": "Jan Kowalski",
        "email": "jan.kowalski@firma.pl"
      }
    }
  ],
  "meta": {
    "total": 1,
    "limit": 50,
    "offset": 0,
    "statuses_included": ["approved"]
  }
}
```

#### Opis pól obiektu wniosku

| Pole | Typ | Opis |
|------|-----|------|
| `id` | uuid | Unikalny identyfikator wniosku |
| `description` | string | Opis / nazwa towaru lub usługi |
| `delivery_location` | string | `Botaniczna` / `Budowlanych` / `Lęborska` |
| `priority` | string | `niski` / `normalny` / `wysoki` / `pilny` |
| `status` | string | `pending` / `approved` / `rejected` / `paid` |
| `gross_amount` | decimal | Kwota brutto |
| `quantity` | integer | Ilość sztuk |
| `link` | string | Link do produktu (opcjonalny) |
| `paid_at` | timestamptz\|null | Kiedy oznaczono jako zapłacone |
| `created_at` | timestamptz | Data złożenia wniosku |
| `updated_at` | timestamptz | Data ostatniej modyfikacji |
| `proforma_filename` | string | Oryginalna nazwa pliku PDF proformy |
| `proforma_pdf_base64` | string\|null | Base64 PDF (tylko gdy `include_pdf=true`) |
| `department.id` | uuid | ID działu |
| `department.name` | string | Nazwa działu |
| `department.mpk_code` | string\|null | Kod MPK działu |
| `submitter.id` | uuid | ID wnioskodawcy |
| `submitter.full_name` | string | Imię i nazwisko |
| `submitter.email` | string | Adres email |

---

### 3.2 Pobieranie pojedynczego wniosku

```
GET /functions/v1/purchase-requests-api/proforma/{id}
Authorization: Bearer aurs_...
```

| Parametr | Opis |
|----------|------|
| `id` (path) | UUID wniosku zakupowego |
| `include_pdf` (query) | `true` / `false` |

#### Przykład

```bash
curl -H "Authorization: Bearer aurs_..." \
  "https://{SUPABASE_URL}/functions/v1/purchase-requests-api/proforma/3fa85f64-5717-4562-b3fc-2c963f66afa6?include_pdf=true"
```

Odpowiedź ta sama struktura co powyżej, pole `data` jest obiektem (nie tablicą).

---

### 3.3 Oznaczenie wniosku jako zapłaconego

```
POST /functions/v1/purchase-requests-api/proforma/{id}/mark-paid
Authorization: Bearer aurs_...
```

Endpoint przeznaczony dla systemu zewnętrznego (ERP, finanse) do potwierdzenia że płatność za proformę została zrealizowana.

#### Przykład

```bash
curl -X POST \
  -H "Authorization: Bearer aurs_..." \
  "https://{SUPABASE_URL}/functions/v1/purchase-requests-api/proforma/3fa85f64-5717-4562-b3fc-2c963f66afa6/mark-paid"
```

#### Odpowiedź (200 OK)

```json
{
  "success": true,
  "data": {
    "id": "3fa85f64-5717-4562-b3fc-2c963f66afa6",
    "status": "paid",
    "paid_at": "2026-03-08T14:30:00.000Z"
  }
}
```

#### Logika walidacji

```
1. Znajdź wniosek po ID
   → 404 jeśli nie istnieje

2. Sprawdź czy wniosek jest proformą (proforma_pdf_base64 IS NOT NULL)
   → 404 z komunikatem "This purchase request is not a proforma"

3. Sprawdź status = 'approved'
   → 422 jeśli inny status (np. pending, rejected, paid)

4. Wykonaj UPDATE:
   status = 'paid'
   paid_at = now()
   updated_at = now()

5. Zwróć zaktualizowane dane
```

**Ważne:** Tylko wnioski ze statusem `approved` mogą być oznaczone jako `paid`. Próba oznaczenia wniosku ze statusem `pending` lub `rejected` zwróci HTTP 422.

---

## 4. API Eksportu Faktur

### 4.1 Pobieranie listy faktur

```
GET /functions/v1/invoices-export-api/invoices
Authorization: Bearer aurs_...
```

#### Parametry zapytania

| Parametr | Typ | Domyślnie | Maks. | Opis |
|----------|-----|-----------|-------|------|
| `status` | string | `paid,accepted` | - | Przecinkami: `paid`, `accepted` |
| `from_date` | string | - | - | Format `YYYY-MM-DD`, filtruje po `issue_date >=` |
| `to_date` | string | - | - | Format `YYYY-MM-DD`, filtruje po `issue_date <=` |
| `limit` | integer | `100` | `500` | Ilość rekordów na stronie |
| `offset` | integer | `0` | - | Offset paginacji |
| `include_pdf` | boolean | `false` | - | Dołącz `pdf_base64` do odpowiedzi |

#### Przykład

```bash
curl -H "Authorization: Bearer aurs_..." \
  "https://{SUPABASE_URL}/functions/v1/invoices-export-api/invoices?status=accepted&from_date=2026-01-01&to_date=2026-03-31&limit=100"
```

#### Odpowiedź (200 OK)

```json
{
  "success": true,
  "data": [
    {
      "invoice_number": "FV/2026/03/001",
      "owner_name": "Jan Kowalski",
      "supplier_name": "Przykładowa Sp. z o.o.",
      "supplier_nip": "1234567890",
      "buyer_name": "Kupujący Sp. z o.o.",
      "buyer_nip": "9876543210",
      "issue_date": "2026-03-15",
      "due_date": "2026-04-14",
      "mpk_code": "MPK-001",
      "department_name": "Ecommerce",
      "currency": "PLN",
      "description": "Usługi marketingowe styczeń 2026",
      "internal_comment": null,
      "cost_center_code": "CC-001",
      "cost_center_name": "CC-001 - Marketing",
      "bez_mpk": false,
      "net_amount": 10000.00,
      "tax_amount": 2300.00,
      "gross_amount": 12300.00,
      "pln_gross_amount": 12300.00,
      "exchange_rate": 1.0,
      "status": "accepted",
      "paid_at": null,
      "payment_method": null,
      "updated_at": "2026-03-16T08:00:00Z",
      "pz_number": null,
      "attachments": [],
      "pdf_base64": null,
      "file_mime_type": null
    }
  ],
  "meta": {
    "total": 1,
    "limit": 100,
    "offset": 0,
    "statuses_included": ["accepted"]
  }
}
```

#### Opis pól faktury

| Pole | Typ | Opis |
|------|-----|------|
| `invoice_number` | string | Numer faktury (np. `FV/2026/001`) |
| `owner_name` | string | Imię i nazwisko osoby która wgrała fakturę |
| `supplier_name` | string | Nazwa dostawcy |
| `supplier_nip` | string | NIP dostawcy |
| `buyer_name` | string\|null | Nazwa nabywcy |
| `buyer_nip` | string\|null | NIP nabywcy |
| `issue_date` | date | Data wystawienia `YYYY-MM-DD` |
| `due_date` | date | Termin płatności `YYYY-MM-DD` |
| `mpk_code` | string\|null | Kod MPK |
| `department_name` | string\|null | Nazwa działu |
| `currency` | string | Waluta: `PLN`, `EUR`, `USD`, itp. |
| `description` | string\|null | Opis (zewnętrzny) |
| `internal_comment` | string\|null | Komentarz wewnętrzny |
| `cost_center_code` | string\|null | Kod centrum kosztów |
| `cost_center_name` | string\|null | Format: `KOD - Nazwa` |
| `bez_mpk` | boolean | `true` jeśli faktura bez MPK |
| `net_amount` | decimal | Kwota netto w walucie faktury |
| `tax_amount` | decimal | Kwota VAT |
| `gross_amount` | decimal | Kwota brutto w walucie faktury |
| `pln_gross_amount` | decimal | Kwota brutto przeliczona na PLN |
| `exchange_rate` | decimal | Kurs wymiany do PLN |
| `status` | string | `accepted` lub `paid` |
| `paid_at` | timestamptz\|null | Kiedy oznaczono jako zapłacone |
| `payment_method` | string\|null | `Gotówka` / `Przelew` / `Karta` |
| `updated_at` | timestamptz | Data ostatniej modyfikacji |
| `pz_number` | string\|null | Numer dokumentu PZ |
| `attachments` | array | Lista załączników (patrz niżej) |
| `pdf_base64` | string\|null | Base64 PDF (tylko gdy `include_pdf=true`) |
| `file_mime_type` | string\|null | MIME type pliku (z `include_pdf=true`) |

#### Struktura obiektu załącznika

```json
{
  "id": "uuid",
  "file_name": "zalacznik.pdf",
  "url": "https://drive.google.com/file/d/...",
  "mime_type": "application/pdf",
  "file_size": 102400,
  "created_at": "2026-03-16T10:00:00Z"
}
```

---

### 4.2 Oznaczenie faktury jako zapłaconej

```
POST /functions/v1/invoices-export-api/invoices/{invoice_number}/mark-paid
Authorization: Bearer aurs_...
Content-Type: application/json
```

**Uwaga:** Numer faktury w URL musi być zakodowany (URL encode). Np. `FV/2026/001` → `FV%2F2026%2F001`.

#### Treść żądania (opcjonalna)

```json
{
  "payment_method": "Przelew"
}
```

Dostępne wartości `payment_method`: `Gotówka`, `Przelew`, `Karta`.

#### Przykład

```bash
curl -X POST \
  -H "Authorization: Bearer aurs_..." \
  -H "Content-Type: application/json" \
  -d '{"payment_method": "Przelew"}' \
  "https://{SUPABASE_URL}/functions/v1/invoices-export-api/invoices/FV%2F2026%2F001/mark-paid"
```

#### Odpowiedź (200 OK)

```json
{
  "success": true,
  "data": {
    "invoice_number": "FV/2026/001",
    "status": "paid",
    "paid_at": "2026-03-20T10:00:00.000Z",
    "payment_method": "Przelew"
  }
}
```

#### Logika walidacji

```
1. Znajdź fakturę po invoice_number (URL-decoded)
   → 404 jeśli nie istnieje

2. Jeśli podano payment_method - sprawdź czy jedna z: Gotówka, Przelew, Karta
   → 400 jeśli nieprawidłowa wartość

3. Sprawdź status = 'accepted'
   → 422 jeśli inny status

4. Wykonaj UPDATE:
   status = 'paid'
   paid_at = now()
   updated_at = now()
   payment_method = podana wartość (jeśli podana)

5. Utwórz wpis w audit_log z opisem zmiany

6. Zwróć zaktualizowane dane
```

---

## 5. Aktualizacje zwrotne statusów

Aktualizacje statusów w systemie zewnętrznym mogą płynąć z powrotem do aplikacji na dwa sposoby.

### 5.1 Sposób 1: Bezpośrednie wywołanie API (polling)

System zewnętrzny cyklicznie odpytuje endpoint i gdy zrealizuje zamówienie - wywołuje `mark-paid`:

```
SYSTEM ZEWNĘTRZNY                    APLIKACJA
       │                                 │
       │── GET /proforma?status=approved ──►│
       │◄─────────── lista wniosków ────────│
       │                                 │
       │  [przetwarza, realizuje zamówienie] │
       │                                 │
       │── POST /proforma/{id}/mark-paid ──►│
       │◄──────── { status: "paid" } ───────│
       │                                 │
       │  [aplikacja wysyła powiadomienie   │
       │   do wnioskodawcy o zapłacie]      │
```

### 5.2 Sposób 2: Webhook z ClickUp (push)

Gdy zadanie ClickUp powiązane z wnioskiem zmienia status na skonfigurowany status "zapłacono" - aplikacja automatycznie aktualizuje wniosek:

```
UŻYTKOWNIK W CLICKUP               APLIKACJA
       │                               │
       │ zmienia status zadania        │
       │ np. "In Progress" → "Complete"│
       │                               │
       ▼                               │
   ClickUp API ──── POST ──────────────►│
                  webhook event        │
                  taskStatusUpdated    │
                                       │
                       ┌──────────────┐│
                       │ Webhook      ││
                       │ Handler      ││
                       │              ││
                       │ 1. Wyciągnij ││
                       │    task_id   ││
                       │ 2. Wyciągnij ││
                       │    status    ││
                       │ 3. Sprawdź   ││
                       │    paid_status││
                       │    z config  ││
                       │ 4. Znajdź    ││
                       │    wniosek   ││
                       │    po        ││
                       │    clickup_  ││
                       │    task_id   ││
                       │ 5. UPDATE    ││
                       │    status=   ││
                       │    'paid'    ││
                       └──────────────┘│
```

#### Endpoint webhooka ClickUp

```
POST /functions/v1/clickup-webhook
```

Endpoint jest **publiczny** (nie wymaga tokenu API). ClickUp wysyła zdarzenia bez uwierzytelniania.

#### Format payloadu od ClickUp

```json
{
  "event": "taskStatusUpdated",
  "task_id": "abc123xyz",
  "history_items": [
    {
      "id": "history-item-id",
      "field": "status",
      "after": {
        "status": "Complete",
        "color": "#6bc950",
        "type": "done"
      },
      "before": {
        "status": "In Progress"
      }
    }
  ]
}
```

#### Algorytm dopasowania statusu "zapłacono"

```typescript
// Konfigurowalny status w clickup_config.paid_status
const configuredStatus = config.paid_status?.toLowerCase() || '';

// Domyślne statusy (gdy brak konfiguracji)
const defaultPaidStatuses = [
  'complete', 'completed', 'done', 'closed',
  'paid', 'oplacone', 'opłacone'
];

// Dopasowanie - case-insensitive, częściowe
let isMatch = false;
if (configuredStatus) {
  isMatch = newStatus.includes(configuredStatus)
         || configuredStatus.includes(newStatus);
} else {
  isMatch = defaultPaidStatuses.some(s =>
    newStatus.includes(s) || s.includes(newStatus)
  );
}
```

#### Odpowiedzi webhooka

| Scenariusz | Kod | Odpowiedź |
|-----------|-----|-----------|
| Wniosek oznaczony jako zapłacony | 200 | `{ "success": true, "request_id": "...", "message": "Wniosek oznaczony jako opłacony" }` |
| Wniosek już był zapłacony | 200 | `{ "message": "Wniosek już oznaczony jako opłacony" }` |
| Nie znaleziono wniosku | 200 | `{ "message": "Nie znaleziono wniosku dla task_id: abc123" }` |
| Status nie pasuje do "paid" | 200 | `{ "message": "Status nie pasuje do kryterium zapłaconego" }` |
| Zdarzenie nie dot. statusu | 200 | `{ "message": "Ignorowane zdarzenie: task.moved" }` |

Wszystkie odpowiedzi webhooka mają kod **200** - ClickUp nie ponawia żądań przy błędach, dlatego zdarzenia nieobsłużone są logowane zamiast zwracania kodów błędu.

#### Powiązanie wniosku z zadaniem ClickUp

Kolumna `purchase_requests.clickup_task_id` jest ustawiana automatycznie przez trigger gdy wniosek zostaje zatwierdzony:

```sql
-- Trigger: tr_clickup_on_approval
-- Uruchamia się: AFTER INSERT OR UPDATE na purchase_requests
-- Warunek: status = 'approved' AND clickup_task_id IS NULL AND NOT proforma

PERFORM pg_net.http_post(
  url  => '{SUPABASE_URL}/functions/v1/create-clickup-task',
  body => jsonb_build_object('purchase_request_id', NEW.id)
);
-- Wynik: clickup_task_id i clickup_task_url zapisane w rekordzie
```

#### Logi webhooków

Każdy przychodzący webhook jest logowany w tabeli `clickup_webhook_logs`:

```sql
SELECT received_at, event_name, task_id, extracted_status,
       matched_paid, result_message
FROM clickup_webhook_logs
ORDER BY received_at DESC
LIMIT 50;
```

---

## 6. Schemat bazy danych

### Tabela `purchase_requests`

```sql
CREATE TABLE purchase_requests (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id             uuid NOT NULL REFERENCES auth.users(id),
  department_id       uuid REFERENCES departments(id),
  description         text DEFAULT '',
  link                text DEFAULT '',
  gross_amount        numeric(12,2) DEFAULT 0,
  quantity            integer DEFAULT 1,
  delivery_location   text DEFAULT 'Botaniczna',  -- Botaniczna | Budowlanych | Lęborska
  priority            text DEFAULT 'normalny',    -- niski | normalny | wysoki | pilny
  status              text DEFAULT 'pending',     -- pending | approved | rejected | paid
  proforma_pdf_base64 text,             -- Base64 PDF proformy (NULL = nie jest proformą)
  proforma_filename   text,             -- Oryginalna nazwa pliku
  paid_at             timestamptz,      -- Kiedy oznaczono jako paid
  bez_mpk             boolean DEFAULT false,
  current_approver_id uuid,             -- ID następnego zatwierdzającego
  approver_comment    text,             -- Ostatni komentarz zatwierdzającego
  submitted_at        timestamptz,
  clickup_task_id     text,             -- ID zadania w ClickUp (po zatwierdzeniu)
  clickup_task_url    text,             -- URL zadania w ClickUp
  created_at          timestamptz DEFAULT now(),
  updated_at          timestamptz DEFAULT now()
);
```

### Tabela `purchase_request_approvals`

Historia zatwierdzeń.

```sql
CREATE TABLE purchase_request_approvals (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id  uuid NOT NULL REFERENCES purchase_requests(id),
  approver_id          uuid NOT NULL REFERENCES auth.users(id),
  role                 text,  -- 'Specjalista' | 'Kierownik' | 'Dyrektor'
  action               text,  -- 'approved' | 'rejected'
  comment              text,
  created_at           timestamptz DEFAULT now()
);
```

### Tabela `purchase_request_limits`

Limity automatycznej akceptacji per użytkownik.

```sql
CREATE TABLE purchase_request_limits (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid UNIQUE REFERENCES auth.users(id),
  monthly_limit      numeric(12,2),    -- Miesięczny limit łączny
  single_limit       numeric(12,2),    -- Limit dla jednego wniosku
  auto_approve_limit numeric(12,2),    -- Próg auto-akceptacji
  set_by             uuid,             -- Kto ustawił limit
  created_at         timestamptz DEFAULT now(),
  updated_at         timestamptz DEFAULT now()
);
```

### Tabela `purchase_request_comments`

Komentarze do wniosków.

```sql
CREATE TABLE purchase_request_comments (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  purchase_request_id  uuid NOT NULL REFERENCES purchase_requests(id),
  user_id              uuid NOT NULL REFERENCES profiles(id),
  content              text NOT NULL,  -- max 2000 znaków
  created_at           timestamptz DEFAULT now()
);
```

---

## 7. Przepływ akceptacji wniosku

Wniosek przechodzi przez hierarchię zatwierdzeń zanim trafi do systemu zewnętrznego jako `approved`:

```
Wnioskodawca składa wniosek
           │
           ▼
   Kwota <= auto_approve_limit?
    ┌──── TAK ────┐      ┌──── NIE ────┐
    │             │      │             │
    ▼             │      ▼             │
status='approved' │  Przypisz do      │
(od razu)         │  Kierownika       │
                  │      │             │
                  │      ▼             │
                  │  Kierownik zatwierdza?
                  │   ┌── TAK ──┐  ┌── NIE ──┐
                  │   │         │  │         │
                  │   ▼         │  ▼         │
                  │ Istnieje    │ status=    │
                  │ Dyrektor?   │ 'rejected' │
                  │  ┌── TAK ──┐│            │
                  │  │         ││            │
                  │  ▼         ││            │
                  │ Dyrektor   ││            │
                  │ zatwierdza?││            │
                  │  ┌── TAK ──┘│            │
                  │  │          │            │
                  │  ▼          │            │
                  │ status=     │            │
                  └► 'approved' ◄────────────┘
                       │
                       ▼
             Trigger tworzy zadanie w ClickUp
             (jeśli NIE jest proformą)
                       │
                       ▼
             Zewnętrzny system widzi wniosek
             przez GET /proforma?status=approved
```

### Automatyczne progi akceptacji

| Rola | Konfiguracja | Działanie |
|------|-------------|-----------|
| Specjalista | `auto_approve_limit` w `purchase_request_limits` | Wnioski ≤ limitu → `approved` od razu |
| Kierownik | `single_limit` i `monthly_limit` | Decyduje czy eskalować do Dyrektora |
| Dyrektor | `director_approval_limits` | Finalna akceptacja powyżej limitu Kierownika |

---

## 8. Powiadomienia

System automatycznie wysyła powiadomienia wewnętrzne (w aplikacji) przy każdej zmianie statusu:

| Wyzwalacz | Odbiorca | Typ powiadomienia |
|-----------|----------|-------------------|
| Nowy wniosek złożony | `current_approver_id` | `purchase_request_assigned` |
| Eskalacja do Dyrektora | Dyrektor | `purchase_request_assigned` |
| Wniosek zatwierdzony | Wnioskodawca | `purchase_request_approved` |
| Wniosek odrzucony | Wnioskodawca | `purchase_request_rejected` |
| Wniosek oznaczony jako paid | Wnioskodawca | `purchase_request_paid` |
| Nowy komentarz | Zatwierdzający | `purchase_request_comment` |

Powiadomienia są generowane przez triggery PL/pgSQL w tabeli `notifications`.

---

## 9. Obsługa błędów

### Kody błędów - Wnioski zakupowe

| Kod HTTP | Scenariusz | Komunikat |
|----------|-----------|-----------|
| `200` | Sukces | `{ "success": true, ... }` |
| `400` | Nieprawidłowy parametr `status` | `"Invalid status filter..."` |
| `401` | Brak/nieprawidłowy token API | `"Unauthorized: invalid or missing API token"` |
| `404` | Wniosek nie znaleziony | `"Purchase request not found: {id}"` |
| `404` | Wniosek nie jest proformą | `"This purchase request is not a proforma..."` |
| `404` | Nieznany endpoint | `"Not found"` |
| `422` | Nieprawidłowy status do mark-paid | `"Purchase request cannot be marked as paid. Current status: \"{status}\""` |
| `500` | Błąd bazy danych | `"Failed to update purchase request status"` |

### Kody błędów - Faktury

| Kod HTTP | Scenariusz | Komunikat |
|----------|-----------|-----------|
| `200` | Sukces | `{ "success": true, ... }` |
| `400` | Nieprawidłowy `payment_method` | `"Invalid payment_method. Allowed values: Gotówka, Przelew, Karta"` |
| `401` | Brak/nieprawidłowy token | `"Unauthorized: invalid or missing API token"` |
| `404` | Faktura nie znaleziona | `"Invoice not found: {invoice_number}"` |
| `422` | Status nie jest `accepted` | `"Invoice cannot be marked as paid. Current status: \"{status}\""` |
| `500` | Błąd bazy danych | `"Failed to update invoice status"` |

### Format odpowiedzi błędu

```json
{
  "success": false,
  "error": "Opis błędu"
}
```

---

## Przykład pełnego scenariusza integracji

```
DZIEŃ 1 - System zewnętrzny (ERP) odpytuje nowe proformy:

  GET /proforma?status=approved&include_pdf=true
  → Zwraca listę zatwierdzonych wniosków z plikami PDF

  ERP pobiera dane:
  - ID: 3fa85f64
  - Opis: Zakup serwera Dell
  - Kwota: 45 000,00 PLN
  - Dział: IT (MPK-010)
  - PDF proformy: JVBERi0...

DZIEŃ 5 - ERP realizuje zamówienie i potwierdza zapłatę:

  POST /proforma/3fa85f64-5717-4562-b3fc-2c963f66afa6/mark-paid
  → { "status": "paid", "paid_at": "2026-03-08T14:30:00Z" }

JEDNOCZEŚNIE - alternatywna ścieżka przez ClickUp:

  Manager zmienia status zadania w ClickUp na "Complete"
  → ClickUp wysyła webhook do /clickup-webhook
  → Aplikacja automatycznie ustawia status = 'paid'
  → Wnioskodawca otrzymuje powiadomienie "Twój wniosek został opłacony"
```

---

## Paginacja

Oba API obsługują paginację przez `limit` i `offset`:

```bash
# Strona 1 (rekordy 1-100)
GET /invoices?limit=100&offset=0

# Strona 2 (rekordy 101-200)
GET /invoices?limit=100&offset=100

# Sprawdź meta.total aby wiedzieć ile stron
```

Odpowiedź zawsze zawiera:
```json
"meta": {
  "total": 347,
  "limit": 100,
  "offset": 0,
  "statuses_included": ["accepted", "paid"]
}
```

Maksymalny `limit` to `500` rekordów na jedno żądanie.
