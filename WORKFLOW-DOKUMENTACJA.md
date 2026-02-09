# Dokumentacja Workflow Akceptacji Faktur

## Podsumowanie

System automatycznego workflow akceptacji faktur z obsługą limitów działowych.

## Zasady Workflow

### 1. Specjalista Wysyła Fakturę

**Akcja:** Specjalista dodaje fakturę i zmienia status na `waiting`

**Rezultat:**
- Faktura automatycznie przypisywana do Kierownika działu (`current_approver_id`)
- Status: `waiting`
- Faktura widoczna dla Specjalisty (twórcy) i Kierownika (akceptującego)

**Przykład:**
```
Specjalista p.dudek (IT) → dodaje fakturę → status: waiting
→ przypisana do Kierownika s.hoffman
```

---

### 2. Kierownik Akceptuje Fakturę

**Akcja:** Kierownik zmienia status na `accepted`

**System automatycznie sprawdza:**

#### A) Limit Pojedynczej Faktury (`max_invoice_amount`)
- Czy kwota faktury ≤ `max_invoice_amount` działu?

**Przykład:**
```
Faktura: 7000 PLN
Limit działu IT: 5000 PLN
Wynik: 7000 > 5000 → PRZEKROCZENIE
```

#### B) Limit Miesięczny (`max_monthly_amount`)
- Suma wszystkich faktur `accepted` i `paid` w tym miesiącu
- Czy (suma_obecna + nowa_faktura) ≤ `max_monthly_amount`?

**Przykład:**
```
Obecna suma w lutym 2026: 8000 PLN
Nowa faktura: 45000 PLN
Suma: 53000 PLN
Limit miesięczny IT: 50000 PLN
Wynik: 53000 > 50000 → PRZEKROCZENIE
```

#### Rezultaty:

##### ✅ Faktura mieści się w limitach
- Status: `accepted` (finalna akceptacja)
- `current_approver_id`: NULL
- `approved_by_manager_at`: ustawione
- Audit log: `auto_accepted_within_limits`

**Przykład:**
```
TEST-WORKFLOW-001: 1000 PLN < 5000 PLN
→ auto-accepted
```

##### ❌ Faktura przekracza limity
- Status: `waiting` (nadal czeka)
- `current_approver_id`: Dyrektor działu
- `approved_by_manager_at`: ustawione (Kierownik zatwierdził przejście)
- Audit log: `forwarded_to_director` z powodem

**Przykład:**
```
TEST-WORKFLOW-002: 7000 PLN > 5000 PLN
→ forwarded to Director (single_invoice_limit)

TEST-WORKFLOW-003: 45000 PLN
→ forwarded to Director (single_invoice_limit)
```

---

### 3. Dyrektor Akceptuje Fakturę

**Akcja:** Dyrektor zmienia status na `accepted`

**Rezultat:**
- Status: `accepted` (finalna akceptacja)
- `current_approver_id`: NULL
- `approved_by_director_at`: ustawione
- Audit log: `approved_by_director`
- Limity NIE są sprawdzane (Dyrektor ma pełne uprawnienia)

**Przykład:**
```
Dyrektor a.tkaczyk → akceptuje TEST-WORKFLOW-002
→ status: accepted (mimo że przekracza limit Kierownika)
```

---

## Limity Działowe

Limity konfigurowane w tabeli `departments`:

### `max_invoice_amount`
- Limit na pojedynczą fakturę
- Jeśli faktura przekracza → Kierownik przekazuje do Dyrektora
- `NULL` = brak limitu

### `max_monthly_amount`
- Limit na sumę faktur w danym miesiącu
- Miesiąc liczony od `issue_date` (lub `created_at` jeśli brak)
- Suma tylko faktur w statusie `accepted` lub `paid`
- Jeśli suma przekroczy → Kierownik przekazuje do Dyrektora
- `NULL` = brak limitu

**Przykład konfiguracji dla działu IT:**
```sql
max_invoice_amount: 5000.00 PLN
max_monthly_amount: 50000.00 PLN
```

---

## Testy Workflow

### Test 1: Faktura w limitach ✅

```
Faktura: TEST-WORKFLOW-001
Kwota: 1000 PLN
Status początkowy: waiting → assigned to Kierownik s.hoffman

Kierownik akceptuje:
- Sprawdzenie: 1000 < 5000 ✓
- Sprawdzenie: miesięczna suma OK ✓
→ status: accepted
→ current_approver_id: NULL
→ Audit log: "auto_accepted_within_limits"
```

### Test 2: Faktura przekracza limit pojedynczy ❌

```
Faktura: TEST-WORKFLOW-002
Kwota: 7000 PLN
Status początkowy: waiting → assigned to Kierownik s.hoffman

Kierownik akceptuje:
- Sprawdzenie: 7000 > 5000 ✗
→ status: waiting
→ current_approver_id: Dyrektor a.tkaczyk
→ Audit log: "forwarded_to_director" (single_invoice_limit)

Dyrektor akceptuje:
→ status: accepted
→ approved_by_director_at: ustawione
```

### Test 3: Faktura przekracza limit miesięczny ❌

```
Faktura: TEST-WORKFLOW-003
Kwota: 45000 PLN
Obecna suma: 8000 PLN
Nowa suma: 53000 PLN > 50000 PLN

Kierownik akceptuje:
- Sprawdzenie: 45000 > 5000 ✗ (najpierw sprawdzony limit pojedynczy)
→ status: waiting
→ current_approver_id: Dyrektor a.tkaczyk
→ Audit log: "forwarded_to_director" (single_invoice_limit)

(W tym przypadku system wykrył najpierw limit pojedynczej faktury)
```

---

## Widoczność Faktur

### Podczas Workflow

#### Specjalista
- Widzi TYLKO swoje faktury (`uploaded_by = auth.uid()`)
- Nie widzi faktur innych użytkowników

#### Kierownik
- Widzi faktury własne
- Widzi faktury od Specjalistów ze swojego działu
- Widzi faktury przypisane do siebie (`current_approver_id = auth.uid()`)

#### Dyrektor
- Widzi faktury ze swojego działu i poddziałów
- Widzi faktury przypisane do siebie (`current_approver_id = auth.uid()`)

#### CEO
- Widzi wszystkie faktury

---

## Audit Log

System automatycznie loguje każdy krok workflow:

### Zdarzenia logowane:

1. **`created`** - Faktura dodana do systemu
2. **`assigned_to_approver`** - Przypisanie do Kierownika/Dyrektora
3. **`status_changed`** - Zmiana statusu
4. **`auto_accepted_within_limits`** - Auto-akceptacja (mieści się w limitach)
5. **`forwarded_to_director`** - Przekazanie do Dyrektora (z powodem)
6. **`approved_by_director`** - Finalna akceptacja przez Dyrektora

### Przykładowy log:

```json
{
  "action": "forwarded_to_director",
  "description": "Faktura przekazana do Dyrektora - Faktura (7000.00 PLN) przekracza limit pojedynczej faktury (5000.00 PLN)",
  "new_values": {
    "reason": "single_invoice_limit",
    "message": "Faktura (7000.00 PLN) przekracza limit pojedynczej faktury (5000.00 PLN)",
    "limit_value": 5000.00,
    "invoice_value": 7000.00
  }
}
```

---

## Konfiguracja Działów

### Przypisanie Kierownika i Dyrektora

W tabeli `departments`:
```sql
UPDATE departments
SET
    manager_id = 'uuid-kierownika',
    director_id = 'uuid-dyrektora',
    max_invoice_amount = 5000.00,
    max_monthly_amount = 50000.00
WHERE name = 'IT';
```

### Hierarchia

Jeśli w tabeli `departments` nie ma przypisanego `manager_id` lub `director_id`, system szuka w tabeli `profiles`:

```sql
-- Szukaj Kierownika
SELECT id FROM profiles
WHERE department_id = 'uuid-dzialu'
AND role = 'Kierownik'
LIMIT 1;

-- Szukaj Dyrektora
SELECT id FROM profiles
WHERE department_id = 'uuid-dzialu'
AND role = 'Dyrektor'
LIMIT 1;
```

---

## Funkcje Pomocnicze

### `check_department_limits()`
Sprawdza czy faktura mieści się w limitach działu.

**Parametry:**
- `p_department_id` - ID działu
- `p_invoice_amount` - kwota faktury (w PLN)
- `p_invoice_date` - data faktury
- `p_exclude_invoice_id` - ID faktury do wykluczenia (opcjonalne)

**Zwraca:**
```json
{
  "within_limits": true/false,
  "reason": "single_invoice_limit" | "monthly_limit",
  "limit_value": 5000.00,
  "invoice_value": 7000.00,
  "message": "Opis błędu"
}
```

### `handle_invoice_approval()`
Główna funkcja workflow - obsługuje akceptację przez Kierownika/Dyrektora.

**Trigger:** `BEFORE UPDATE OF status ON invoices`

**Warunek:** `NEW.status = 'accepted' AND OLD.status = 'waiting'`

---

## Baza Danych

### Nowe Kolumny w `invoices`

| Kolumna | Typ | Opis |
|---------|-----|------|
| `current_approver_id` | uuid | Kto aktualnie ma zatwierdzić fakturę |
| `approved_by_manager_at` | timestamptz | Kiedy Kierownik zatwierdził |
| `approved_by_director_at` | timestamptz | Kiedy Dyrektor zatwierdził |

### Kolumny w `departments`

| Kolumna | Typ | Opis |
|---------|-----|------|
| `manager_id` | uuid | Kierownik działu |
| `director_id` | uuid | Dyrektor działu |
| `max_invoice_amount` | numeric | Limit na pojedynczą fakturę |
| `max_monthly_amount` | numeric | Limit miesięczny działu |

---

## Polityki RLS

### Widoczność Faktur
```sql
-- Kierownik widzi faktury przypisane do siebie
current_approver_id = auth.uid()

-- Dyrektor widzi faktury przypisane do siebie
current_approver_id = auth.uid()
```

### Akceptacja Faktur
```sql
-- Użytkownik może akceptować faktury przypisane do niego
CREATE POLICY "Users can accept invoices assigned to them"
ON invoices FOR UPDATE
USING (current_approver_id = auth.uid())
WITH CHECK (current_approver_id = auth.uid());
```

---

## Przykłady Użycia

### 1. Specjalista dodaje fakturę

```typescript
const { data, error } = await supabase
  .from('invoices')
  .insert({
    invoice_number: 'FV/2026/001',
    supplier_name: 'Acme Corp',
    gross_amount: 3000.00,
    currency: 'PLN',
    status: 'waiting',  // Automatycznie przypisane do Kierownika
  });
```

### 2. Kierownik akceptuje fakturę

```typescript
const { data, error } = await supabase
  .from('invoices')
  .update({ status: 'accepted' })
  .eq('id', invoiceId)
  .eq('current_approver_id', userId);  // Sprawdź czy przypisana do mnie
```

**System automatycznie:**
- Sprawdzi limity
- Zaakceptuje lub przekaże do Dyrektora

### 3. Dyrektor akceptuje fakturę

```typescript
const { data, error } = await supabase
  .from('invoices')
  .update({ status: 'accepted' })
  .eq('id', invoiceId)
  .eq('current_approver_id', userId);
```

**System automatycznie:**
- Finalnie zaakceptuje
- Ustawi `approved_by_director_at`
- Wyczyści `current_approver_id`

---

## Scenariusze Edge Case

### 1. Brak Dyrektora w Dziale

Jeśli Kierownik zaakceptuje fakturę która przekracza limity, ale w dziale nie ma Dyrektora:

**Rezultat:**
- Faktura zostanie zaakceptowana mimo przekroczenia
- Audit log: `accepted_without_director`
- Warning w logach: "Invoice exceeds limits but no Director found"

### 2. Limity NULL (brak limitów)

Jeśli `max_invoice_amount` lub `max_monthly_amount` są NULL:

**Rezultat:**
- Limit nie jest sprawdzany
- Wszystkie faktury automatycznie akceptowane przez Kierownika

### 3. CEO lub Admin akceptuje

CEO i Admin mogą akceptować faktury bezpośrednio:

**Rezultat:**
- Status: `accepted`
- Limity NIE są sprawdzane
- `current_approver_id`: NULL

---

## Migracje

### 1. `add_invoice_approval_workflow_and_limits.sql`
- Dodaje kolumny workflow do `invoices`
- Tworzy funkcję `check_department_limits()`
- Tworzy funkcję `handle_invoice_approval()`
- Dodaje trigger `invoice_approval_workflow_trigger`

### 2. `update_rls_for_current_approver.sql`
- Aktualizuje polityki RLS dla widoczności
- Dodaje politykę UPDATE dla akceptacji

### 3. `fix_auto_assign_trigger_audit_log.sql`
- Naprawia trigger auto-przypisania
- Dodaje osobny trigger do logowania

---

## Testowanie w Produkcji

### 1. Sprawdź konfigurację działu

```sql
SELECT
    name,
    max_invoice_amount,
    max_monthly_amount,
    (SELECT email FROM profiles WHERE id = manager_id) as manager,
    (SELECT email FROM profiles WHERE id = director_id) as director
FROM departments
WHERE name = 'IT';
```

### 2. Dodaj testową fakturę

```sql
-- Jako Specjalista, dodaj fakturę która mieści się w limitach
INSERT INTO invoices (...) VALUES (...);

-- Sprawdź czy została przypisana do Kierownika
SELECT current_approver_id FROM invoices WHERE invoice_number = 'TEST';
```

### 3. Zaakceptuj jako Kierownik

```sql
-- Zmień status na accepted
UPDATE invoices SET status = 'accepted' WHERE invoice_number = 'TEST';

-- Sprawdź czy została auto-zaakceptowana lub przekazana do Dyrektora
SELECT status, current_approver_id FROM invoices WHERE invoice_number = 'TEST';
```

### 4. Sprawdź audit log

```sql
SELECT action, description, created_at
FROM audit_logs
WHERE invoice_id = (SELECT id FROM invoices WHERE invoice_number = 'TEST')
ORDER BY created_at;
```

---

## Kontakt i Wsparcie

W razie problemów sprawdź:
1. Logi bazy danych: Supabase Dashboard → Database → Logs
2. Audit logs: tabela `audit_logs`
3. Polityki RLS: `SELECT * FROM pg_policies WHERE tablename = 'invoices'`
4. Triggery: `SELECT * FROM information_schema.triggers WHERE event_object_table = 'invoices'`
