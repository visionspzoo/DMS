# Dokumentacja Techniczna: Integracja ClickUp

## Spis treści

1. [Przegląd architektury](#1-przegląd-architektury)
2. [Schemat bazy danych](#2-schemat-bazy-danych)
3. [Przepływ tworzenia zadania (Purchase Request → ClickUp)](#3-przepływ-tworzenia-zadania)
4. [Przepływ synchronizacji statusu (ClickUp → Aplikacja)](#4-przepływ-synchronizacji-statusu)
5. [Edge Functions](#5-edge-functions)
6. [Mapowanie pól](#6-mapowanie-pól)
7. [Konfiguracja Webhook](#7-konfiguracja-webhook)
8. [Frontend - Panel konfiguracyjny](#8-frontend---panel-konfiguracyjny)
9. [Bezpieczeństwo i RLS](#9-bezpieczeństwo-i-rls)
10. [Logi i debugowanie](#10-logi-i-debugowanie)

---

## 1. Przegląd architektury

Integracja ClickUp działa w dwóch kierunkach:

```
KIERUNEK 1: Aplikacja → ClickUp (tworzenie zadania)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Wniosek zakupowy zatwierdzony
            ↓
  Trigger PL/pgSQL w bazie danych
            ↓
  HTTP POST (pg_net) → Edge Function create-clickup-task
            ↓
  Pobranie mapowań pól z bazy
            ↓
  Wywołanie ClickUp API → CREATE TASK
            ↓
  Zapis clickup_task_id + clickup_task_url w bazie

KIERUNEK 2: ClickUp → Aplikacja (synchronizacja statusu)
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Użytkownik zmienia status zadania w ClickUp
            ↓
  ClickUp wysyła Webhook Event (taskStatusUpdated)
            ↓
  Edge Function clickup-webhook odbiera POST
            ↓
  Dopasowanie statusu do skonfigurowanego "paid_status"
            ↓
  UPDATE purchase_requests SET status='paid', paid_at=NOW()
```

---

## 2. Schemat bazy danych

### Tabela: `clickup_config`

Przechowuje globalną konfigurację integracji (jedna konfiguracja na całą aplikację).

```sql
CREATE TABLE clickup_config (
  id                   uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  api_token            text,                  -- Personal API Token ClickUp (pk_*)
  list_id              text,                  -- ID listy ClickUp, gdzie trafiają zadania
  enabled              boolean DEFAULT false, -- czy integracja jest aktywna
  paid_status          text DEFAULT '',       -- nazwa statusu w ClickUp oznaczającego "zapłacono"
  clickup_webhook_id   text,                  -- ID webhooka po rejestracji (do usunięcia/sprawdzenia)
  app_url              text DEFAULT '',       -- bazowy URL aplikacji (do generowania linków)
  cached_custom_fields jsonb,                 -- cache pól custom z ClickUp
  created_at           timestamptz DEFAULT now(),
  updated_at           timestamptz DEFAULT now(),
  updated_by           uuid REFERENCES profiles(id)
);
```

### Tabela: `clickup_field_mappings`

Mapowanie pól aplikacji na **pola custom** w ClickUp.

```sql
CREATE TABLE clickup_field_mappings (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  clickup_field_id      text,      -- ID pola custom w ClickUp
  clickup_field_name    text,      -- Nazwa pola (wyświetlana)
  clickup_field_type    text,      -- Typ: text, number, drop_down, labels, currency, itp.
  app_field             text,      -- Pole z purchase_requests do zmapowania
  app_field_label       text,      -- Etykieta czytelna dla człowieka
  enabled               boolean DEFAULT true,
  sort_order            integer DEFAULT 0,
  created_at            timestamptz DEFAULT now(),
  updated_at            timestamptz DEFAULT now()
);
```

### Tabela: `clickup_standard_field_mappings`

Mapowanie pól aplikacji na **standardowe pola** zadania ClickUp: nazwę, opis i priorytet.

```sql
CREATE TABLE clickup_standard_field_mappings (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  field_target    text,      -- 'name' | 'description' | 'priority'
  label           text,      -- prefiks/etykieta linii (np. "Dział:")
  app_field       text,      -- pole z purchase_requests
  app_field_label text,      -- etykieta dla UI
  enabled         boolean DEFAULT true,
  sort_order      integer DEFAULT 0,
  created_at      timestamptz DEFAULT now(),
  updated_at      timestamptz DEFAULT now()
);
```

### Tabela: `clickup_webhook_logs`

Rejestr wszystkich przychodzących webhooków (do debugowania i audytu).

```sql
CREATE TABLE clickup_webhook_logs (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  received_at      timestamptz DEFAULT now(),
  event_name       text,      -- np. "taskStatusUpdated"
  task_id          text,      -- ID zadania z ClickUp
  extracted_status text,      -- wyekstrahowany nowy status
  raw_payload      jsonb,     -- pełny payload webhooka
  matched_paid     boolean,   -- czy status pasował do "paid_status"
  result_message   text       -- wynik przetwarzania
);
```

### Kolumny dodane do `purchase_requests`

```sql
ALTER TABLE purchase_requests ADD COLUMN clickup_task_id  text;    -- ID zadania w ClickUp
ALTER TABLE purchase_requests ADD COLUMN clickup_task_url text;    -- URL zadania w ClickUp
ALTER TABLE purchase_requests ADD COLUMN paid_at          timestamptz; -- kiedy oznaczono jako zapłacone
```

---

## 3. Przepływ tworzenia zadania

### Krok 1: Trigger PL/pgSQL

Gdy wniosek zakupowy zmienia status na `approved`, uruchamia się trigger:

```sql
-- Trigger: tr_clickup_on_approval
-- Tabela: purchase_requests
-- Zdarzenie: AFTER INSERT OR UPDATE

CREATE OR REPLACE FUNCTION notify_clickup_on_approval()
RETURNS TRIGGER AS $$
DECLARE
  v_should_fire boolean := false;
BEGIN
  -- Nie twórz zadania dla wniosków proforma
  IF NEW.proforma_pdf_base64 IS NOT NULL THEN
    RETURN NEW;
  END IF;

  -- Sprawdź czy należy uruchomić (status 'approved', brak istniejącego zadania)
  IF TG_OP = 'INSERT' THEN
    v_should_fire := NEW.status = 'approved' AND NEW.clickup_task_id IS NULL;
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_fire := NEW.status = 'approved'
                 AND (OLD.status IS DISTINCT FROM 'approved')
                 AND NEW.clickup_task_id IS NULL;
  END IF;

  IF v_should_fire THEN
    -- Asynchroniczne wywołanie edge function przez pg_net
    PERFORM pg_net.http_post(
      url     => 'https://{PROJECT_REF}.supabase.co/functions/v1/create-clickup-task',
      headers => jsonb_build_object(
        'Content-Type',  'application/json',
        'Authorization', 'Bearer {SERVICE_ROLE_KEY}',
        'apikey',        '{ANON_KEY}'
      ),
      body    => jsonb_build_object('purchase_request_id', NEW.id)
    );
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;
```

**Warunki uruchomienia triggera:**
- Status wniosku = `approved`
- Wniosek nie jest wnioskiem proforma (`proforma_pdf_base64 IS NULL`)
- Nie ma jeszcze powiązanego zadania ClickUp (`clickup_task_id IS NULL`)
- Przy UPDATE: status musi się zmienić na `approved` (a nie być już `approved`)

### Krok 2: Edge Function `create-clickup-task`

Funkcja buduje zadanie na podstawie mapowań i tworzy je w ClickUp API.

**Budowanie nazwy zadania:**

```typescript
// Pobierz mapowania dla field_target = 'name', sorted by sort_order
const nameMappings = standardMappings.filter(m => m.field_target === 'name' && m.enabled);

if (nameMappings.length > 0) {
  // Złącz wartości mapowanych pól: "Wartość1 - Wartość2"
  taskName = nameMappings
    .map(m => getAppFieldValue(request, m.app_field))
    .filter(Boolean)
    .join(' - ');
} else {
  // Fallback
  taskName = `Wniosek zakupowy: ${request.description.slice(0, 80)}`;
}
```

**Budowanie opisu zadania:**

```typescript
const descMappings = standardMappings.filter(m => m.field_target === 'description' && m.enabled);

if (descMappings.length > 0) {
  // Każde mapowanie tworzy linię: "Etykieta: wartość"
  let lines = descMappings.map(m => {
    const value = getAppFieldValue(request, m.app_field);
    return `**${m.label || m.app_field_label}** ${value}`;
  });

  // Dołącz link do aplikacji jeśli skonfigurowany
  if (config.app_url) {
    lines.push(`\n[Otwórz wniosek w aplikacji](${config.app_url}?view=my-purchase-requests&pr=${request.id})`);
  }

  taskDescription = lines.join('\n');
}
```

**Mapowanie priorytetu:**

| Priorytet w aplikacji | Priorytet w ClickUp |
|-----------------------|---------------------|
| `pilny` / `urgent`    | 1 (urgent)          |
| `wysoki` / `high`     | 2 (high)            |
| `normalny` / `normal` | 3 (normal) - domyślny |
| `niski` / `low`       | 4 (low)             |

**Mapowanie pól custom:**

```typescript
// Pobierz pola custom z ClickUp i mapowania
const fieldMappings = await supabase.from('clickup_field_mappings')
  .select('*').eq('enabled', true).order('sort_order');

const customFields = fieldMappings.map(mapping => {
  const value = getAppFieldValue(request, mapping.app_field);

  switch (mapping.clickup_field_type) {
    case 'drop_down':
    case 'labels':
      // Znajdź opcję po nazwie, użyj jej ID
      const option = clickupField.type_config.options
        .find(o => o.name.toLowerCase() === value.toLowerCase());
      return { id: mapping.clickup_field_id, value: option?.id };

    case 'number':
    case 'currency':
      return { id: mapping.clickup_field_id, value: parseFloat(value) };

    default:
      return { id: mapping.clickup_field_id, value: String(value) };
  }
});
```

**Wywołanie API ClickUp:**

```
POST https://api.clickup.com/api/v2/list/{list_id}/task
Authorization: {api_token}
Content-Type: application/json

{
  "name": "Nazwa zadania",
  "description": "Opis...",
  "priority": 3,
  "notify_all": false,
  "custom_fields": [
    { "id": "field_id_1", "value": "wartość" },
    { "id": "field_id_2", "value": 1500 }
  ]
}
```

**Zapis wyniku w bazie:**

```sql
UPDATE purchase_requests
SET
  clickup_task_id  = 'abc123xyz',
  clickup_task_url = 'https://app.clickup.com/t/abc123xyz'
WHERE id = '{request_id}';
```

---

## 4. Przepływ synchronizacji statusu

### Krok 1: ClickUp wysyła Webhook

Po zmianie statusu zadania ClickUp wysyła POST na zarejestrowany endpoint:

```
POST {SUPABASE_URL}/functions/v1/clickup-webhook
Content-Type: application/json

{
  "event": "taskStatusUpdated",
  "task_id": "abc123xyz",
  "history_items": [
    {
      "id": "abc123xyz",
      "type": 2,
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

### Krok 2: Edge Function `clickup-webhook` przetwarza zdarzenie

```typescript
// 1. Wyekstrahuj task ID (wiele formatów payloadu)
const taskId = body.task_id
  || body.id
  || body.task?.id
  || body.history_items?.[0]?.id;

// 2. Wyekstrahuj nowy status
const newStatus = (
  body.history_items?.[0]?.after?.status
  || body.task?.status?.status
  || ''
).toLowerCase().trim();

// 3. Sprawdź czy to zdarzenie zmiany statusu
const eventName = (body.event || '').toLowerCase();
const isStatusEvent = eventName.includes('taskstatusupdated')
  || eventName.includes('task.status')
  || eventName.includes('task_status');

if (!isStatusEvent) {
  // Zaloguj i zakończ (nie status update)
  return new Response(JSON.stringify({ skipped: true }), { status: 202 });
}

// 4. Pobierz skonfigurowany paid_status
const { data: config } = await supabase
  .from('clickup_config')
  .select('paid_status')
  .maybeSingle();

const configuredStatus = config?.paid_status?.toLowerCase().trim() || '';

// 5. Lista domyślnych statusów jeśli nie skonfigurowano
const defaultPaidStatuses = [
  'complete', 'completed', 'done', 'closed',
  'paid', 'oplacone', 'opłacone'
];

// 6. Sprawdź dopasowanie (case-insensitive, częściowe)
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

### Krok 3: Aktualizacja wniosku zakupowego

```typescript
if (isMatch) {
  // Znajdź wniosek po clickup_task_id
  const { data: request } = await supabase
    .from('purchase_requests')
    .select('id, status')
    .eq('clickup_task_id', taskId)
    .maybeSingle();

  if (request && request.status !== 'paid') {
    // Oznacz jako zapłacony
    await supabase
      .from('purchase_requests')
      .update({
        status: 'paid',
        paid_at: new Date().toISOString()
      })
      .eq('id', request.id);
  }
}
```

### Krok 4: Zapis logu

Każdy przychodzący webhook jest logowany w `clickup_webhook_logs` niezależnie od wyniku przetwarzania.

---

## 5. Edge Functions

### `create-clickup-task` - Dostępne akcje

| Akcja | Opis |
|-------|------|
| (domyślna) | Tworzy zadanie w ClickUp dla podanego `purchase_request_id` |
| `test_connection` | Weryfikuje API token, zwraca workspace name |
| `fetch_list_fields` | Pobiera i cachuje pola custom z listy ClickUp |
| `register_webhook` | Rejestruje webhook w ClickUp API |
| `check_webhook` | Sprawdza czy webhook jest aktywny |
| `delete_webhook` | Usuwa webhook z ClickUp API |

**Przykładowe wywołanie z frontendu:**

```typescript
const response = await fetch(
  `${VITE_SUPABASE_URL}/functions/v1/create-clickup-task`,
  {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${VITE_SUPABASE_ANON_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({ action: 'test_connection' })
  }
);
```

### `clickup-webhook` - Endpoint publiczny

```
POST {SUPABASE_URL}/functions/v1/clickup-webhook
```

Nie wymaga autoryzacji (publiczny endpoint dla ClickUp). Weryfikacja autentyczności przez dopasowanie task ID do rekordów w bazie.

---

## 6. Mapowanie pól

### Dostępne pola aplikacji (`app_field`)

| Wartość `app_field` | Źródło danych | Przykład |
|---------------------|---------------|---------|
| `description` | `purchase_requests.description` | "Laptop Dell XPS 15" |
| `gross_amount` | `purchase_requests.gross_amount` | "5000" |
| `quantity` | `purchase_requests.quantity` | "2" |
| `delivery_location` | `purchase_requests.delivery_location` | "Warszawa" |
| `priority` | `purchase_requests.priority` | "wysoki" |
| `link` | `purchase_requests.link` | "https://..." |
| `submitter.full_name` | `profiles.full_name` (wnioskodawca) | "Jan Kowalski" |
| `submitter.email` | `profiles.email` (wnioskodawca) | "jan@firma.pl" |
| `department.name` | `departments.name` | "IT" |
| `bez_mpk` | `purchase_requests.bez_mpk` | "Tak" / "Nie" |
| `created_at` | `purchase_requests.created_at` | "29.03.2026 10:30" |
| `id` | `purchase_requests.id` (pierwsze 9 znaków) | "a1b2c3d4e" |

---

## 7. Konfiguracja Webhook

### Rejestracja webhooka przez aplikację

Aplikacja może automatycznie zarejestrować webhook w ClickUp:

```typescript
// Akcja: register_webhook
// Edge function woła ClickUp API:

// 1. Pobierz Team ID
GET https://api.clickup.com/api/v2/team
Authorization: {api_token}

// 2. Sprawdź istniejące webhooki
GET https://api.clickup.com/api/v2/team/{team_id}/webhook

// 3. Jeśli brak - zarejestruj nowy
POST https://api.clickup.com/api/v2/team/{team_id}/webhook
{
  "endpoint": "{SUPABASE_URL}/functions/v1/clickup-webhook",
  "events": ["taskStatusUpdated"]
}
// Odpowiedź: { "id": "webhook_id_xyz" }

// 4. Zapisz webhook ID w clickup_config
UPDATE clickup_config SET clickup_webhook_id = 'webhook_id_xyz';
```

### Ręczna rejestracja webhooka

Można też zarejestrować webhook ręcznie w panelu ClickUp:

- URL: `{SUPABASE_URL}/functions/v1/clickup-webhook`
- Zdarzenie: `taskStatusUpdated`
- Brak wymaganych nagłówków autoryzacji

---

## 8. Frontend - Panel konfiguracyjny

Plik: `src/components/Settings/ClickUpSettings.tsx`

Dostępny tylko dla administratorów. Trzy zakładki:

### Zakładka: Konfiguracja

- **API Token** - Personal token z ClickUp (format: `pk_*`)
- **List ID** - ID listy, do której trafiają zadania
- **Włącz integrację** - toggle on/off
- **Status "zapłacono"** - nazwa statusu w ClickUp (np. "Complete"), który zmienia status wniosku na `paid`
- **URL aplikacji** - bazowy URL (np. `https://app.firma.pl`) do generowania linków w opisie zadania
- **Webhook** - przyciski: Zarejestruj / Sprawdź / Usuń

### Zakładka: Pola podstawowe

- Konfiguracja co trafi do **nazwy** zadania (kolejność + pola aplikacji)
- Konfiguracja co trafi do **opisu** zadania (etykieta + pole aplikacji)
- **Priorytet** - mapowany automatycznie z pola `priority` wniosku

### Zakładka: Pola custom

- Lista pól custom zaimportowanych z ClickUp
- Dla każdego pola: wybór odpowiadającego pola z aplikacji
- Włącz/wyłącz poszczególne mapowania
- Kolejność sortowania

---

## 9. Bezpieczeństwo i RLS

| Tabela | SELECT | INSERT | UPDATE | DELETE |
|--------|--------|--------|--------|--------|
| `clickup_config` | Admin, Director, Manager | Admin | Admin | - |
| `clickup_field_mappings` | Authenticated | Admin | Admin | Admin |
| `clickup_standard_field_mappings` | Authenticated | Admin | Admin | Admin |
| `clickup_webhook_logs` | Admin | Service Role | - | - |

**Endpoint webhooka jest publiczny** (bez autoryzacji) - ClickUp nie wysyła tokenów weryfikacyjnych w standardowym planie. Bezpieczeństwo opiera się na tym, że webhook może tylko oznaczać wnioski jako `paid` jeśli `clickup_task_id` pasuje do istniejącego rekordu.

**Trigger działa z SECURITY DEFINER** - wykonuje się z uprawnieniami właściciela funkcji (wyższe niż użytkownik), co pozwala na odczyt sekretów potrzebnych do wywołania edge function.

---

## 10. Logi i debugowanie

### Tabela `clickup_webhook_logs`

Każdy przychodzący webhook jest logowany:

```sql
SELECT
  received_at,
  event_name,
  task_id,
  extracted_status,
  matched_paid,
  result_message,
  raw_payload
FROM clickup_webhook_logs
ORDER BY received_at DESC
LIMIT 50;
```

**Możliwe wartości `result_message`:**
- `"Matched paid status, updated request {id}"` - sukces, wniosek oznaczony jako zapłacony
- `"Request already paid"` - pominięto (już zapłacony)
- `"No matching purchase request found"` - brak wniosku z tym `clickup_task_id`
- `"Status did not match paid criteria"` - status nie pasował do kryterium
- `"Not a status update event"` - zdarzenie innego typu

### Sprawdzenie stanu integracji

```sql
-- Wnioski z powiązanymi zadaniami ClickUp
SELECT id, description, status, clickup_task_id, clickup_task_url, paid_at
FROM purchase_requests
WHERE clickup_task_id IS NOT NULL
ORDER BY created_at DESC;

-- Ostatnie logi webhooków
SELECT received_at, task_id, extracted_status, matched_paid, result_message
FROM clickup_webhook_logs
ORDER BY received_at DESC
LIMIT 20;

-- Aktualna konfiguracja (bez tokena)
SELECT list_id, enabled, paid_status, app_url, clickup_webhook_id
FROM clickup_config;
```

---

## Podsumowanie przepływu end-to-end

```
1. ADMIN konfiguruje integrację w ustawieniach
   └─ Podaje API Token, List ID, paid_status, app_url
   └─ Rejestruje webhook w ClickUp

2. UŻYTKOWNIK składa wniosek zakupowy
   └─ Status: draft → waiting → approved

3. Po zatwierdzeniu (status = approved):
   └─ Trigger PL/pgSQL wykrywa zmianę
   └─ pg_net wysyła async HTTP POST do edge function
   └─ Edge function buduje zadanie z mapowań
   └─ Zadanie pojawia się w ClickUp z polami custom
   └─ clickup_task_id zapisany w bazie

4. MANAGER/DYREKTOR opłaca zamówienie, zmienia status w ClickUp
   └─ ClickUp wysyła webhook na endpoint

5. Edge function clickup-webhook przetwarza webhook:
   └─ Sprawdza czy status = skonfigurowany paid_status
   └─ Jeśli tak → UPDATE purchase_requests SET status='paid'
   └─ Loguje wynik w clickup_webhook_logs

6. Status wniosku w aplikacji zmienia się na "Zapłacono"
   └─ Widoczne dla użytkownika w panelu wniosków
```
