# System Statusów Faktur - Dokumentacja

## Przegląd

System statusów faktur został zaprojektowany aby pokazywać różne statusy w zależności od perspektywy użytkownika. Ta sama faktura może wyświetlać się jako "Oczekujące" dla osoby zatwierdzającej, a jako "W weryfikacji" dla osoby która ją wysłała.

## Statusy w Bazie Danych

W bazie danych faktury mają następujące możliwe statusy:

| Status | Opis |
|--------|------|
| `draft` | Robocza - faktura zapisana jako szkic, nie wysłana do weryfikacji |
| `waiting` | Czeka na zatwierdzenie przez Kierownika lub Dyrektora |
| `accepted` | Zaakceptowana - proces zatwierdzania zakończony pomyślnie |
| `rejected` | Odrzucona - faktura cofnięta w procesie obiegu |
| `paid` | Opłacona - faktura została opłacona |

## Statusy Wyświetlane (Display Status)

W zależności od roli użytkownika i jego relacji z fakturą, statusy są wyświetlane inaczej:

### 1. **Robocze** (`draft`)
- **Widoczność**: Tylko osoba która dodała lub pobrała fakturę
- **Kiedy**: Faktura została zapisana jako szkic, nie wysłana do weryfikacji
- **Status w bazie**: `draft`

### 2. **Oczekujące** (`waiting`)
- **Widoczność**: Osoba która ma zatwierdzić fakturę (Kierownik lub Dyrektor)
- **Kiedy**: Faktura czeka na akcję użytkownika (`current_approver_id = auth.uid()`)
- **Status w bazie**: `waiting`
- **Kto widzi**: Użytkownik przypisany jako `current_approver_id`

### 3. **W weryfikacji** (`in_review`)
- **Widoczność**: Osoba która wysłała fakturę do weryfikacji
- **Kiedy**: Faktura została wysłana i czeka na zatwierdzenie przez kogoś innego
- **Status w bazie**: `waiting`
- **Kto widzi**: Użytkownik który jest `uploaded_by`, ale nie jest `current_approver_id`

### 4. **Zaakceptowana** (`accepted`)
- **Widoczność**: Wszyscy uprawnieni użytkownicy
- **Kiedy**: Faktura przeszła przez cały proces zatwierdzania
- **Status w bazie**: `accepted`

### 5. **Odrzucona** (`rejected`)
- **Widoczność**: Wszyscy uprawnieni użytkownicy
- **Kiedy**: Faktura została odrzucona w procesie weryfikacji
- **Status w bazie**: `rejected`

### 6. **Opłacona** (`paid`)
- **Widoczność**: Wszyscy uprawnieni użytkownicy
- **Kiedy**: Faktura została opłacona
- **Status w bazie**: `paid`

## Przykłady

### Przykład 1: Specjalista wysyła fakturę

**Sytuacja**: Specjalista Jan wysłał fakturę do weryfikacji.

| Użytkownik | Co widzi | Dlaczego |
|------------|----------|----------|
| Jan (Specjalista) | "W weryfikacji" | Jest uploaderem, faktura czeka na Kierownika |
| Kierownik Tomek | "Oczekujące" | Jest przypisany jako `current_approver_id` |
| Dyrektor Anna | Nie widzi | Faktura nie została jeszcze przekazana do Dyrektora |

### Przykład 2: Kierownik akceptuje fakturę, która przekracza limity

**Sytuacja**: Kierownik Tomek akceptuje fakturę, ale kwota przekracza limity działu.

**Akcja systemu**:
1. System sprawdza limity działu
2. Faktura przekracza limity, więc jest automatycznie przekazana do Dyrektora
3. `current_approver_id` zmienia się na Dyrektora Annę
4. Status pozostaje `waiting`

| Użytkownik | Co widzi | Dlaczego |
|------------|----------|----------|
| Jan (Specjalista) | "W weryfikacji" | Faktura nadal w procesie zatwierdzania |
| Kierownik Tomek | "W weryfikacji" | Już nie jest `current_approver_id` |
| Dyrektor Anna | "Oczekujące" | Teraz jest przypisana jako `current_approver_id` |

### Przykład 3: Faktura zaakceptowana

**Sytuacja**: Dyrektor Anna akceptuje fakturę.

**Akcja systemu**:
1. Status zmienia się na `accepted`
2. `current_approver_id` ustawiane na `NULL`

| Użytkownik | Co widzi | Dlaczego |
|------------|----------|----------|
| Jan (Specjalista) | "Zaakceptowana" | Status = `accepted` |
| Kierownik Tomek | "Zaakceptowana" | Status = `accepted` |
| Dyrektor Anna | "Zaakceptowana" | Status = `accepted` |

## Workflow Zatwierdzania

```
Specjalista
    ↓ (wysyła fakturę, status = 'waiting')
    ↓ (Specjalista widzi: "W weryfikacji")
    ↓
Kierownik (widzi: "Oczekujące")
    ↓ (akceptuje)
    ↓
    ├─→ Kwota w limitach?
    │   └─→ TAK → Status = 'accepted' (koniec)
    │
    └─→ NIE → Status = 'waiting', current_approver_id = Dyrektor
        ↓ (Kierownik teraz widzi: "W weryfikacji")
        ↓
    Dyrektor (widzi: "Oczekujące")
        ↓ (akceptuje)
        ↓
    Status = 'accepted' (koniec)
```

## Implementacja Techniczna

### Funkcja `getUserSpecificStatus()`

Funkcja ta oblicza status wyświetlany użytkownikowi na podstawie:
- Statusu faktury w bazie danych
- ID użytkownika
- `current_approver_id` faktury
- `uploaded_by` faktury

```typescript
function getUserSpecificStatus(invoice: Invoice, currentUserId: string): string {
  // Statusy które są zawsze takie same
  if (invoice.status === 'draft') return 'draft';
  if (invoice.status === 'accepted') return 'accepted';
  if (invoice.status === 'rejected') return 'rejected';
  if (invoice.status === 'paid') return 'paid';

  // Status 'waiting' wyświetla się różnie w zależności od perspektywy
  if (invoice.status === 'waiting') {
    // Jestem osobą zatwierdzającą → "Oczekujące"
    if (invoice.current_approver_id === currentUserId) {
      return 'waiting';
    }
    // Jestem uploaderem lub inną osobą → "W weryfikacji"
    if (invoice.uploaded_by === currentUserId) {
      return 'in_review';
    }
    return 'in_review';
  }

  return invoice.status;
}
```

### Filtrowanie Faktur

Filtry w interfejsie używają display statusów, nie rzeczywistych statusów z bazy:

```typescript
// Filtrowanie według display status
if (selectedStatuses.length > 0) {
  filtered = filtered.filter(inv =>
    selectedStatuses.includes(getUserSpecificStatus(inv, profile?.id || ''))
  );
}
```

### Kolory Statusów

| Display Status | Kolor |
|----------------|-------|
| Robocze | Szary (`slate`) |
| Oczekujące | Żółty (`yellow`) |
| W weryfikacji | Niebieski (`blue`) |
| Zaakceptowana | Zielony (`success`) |
| Odrzucona | Czerwony (`error`) |
| Opłacona | Szmaragdowy (`emerald`) |

## Pola w Bazie Danych

### Tabela `invoices`

Nowe/zaktualizowane pola związane z workflow:

| Pole | Typ | Opis |
|------|-----|------|
| `status` | `invoice_status` | Główny status faktury |
| `current_approver_id` | `uuid` | ID użytkownika który obecnie ma zatwierdzić fakturę |
| `approved_by_manager_at` | `timestamptz` | Data zatwierdzenia przez Kierownika |
| `approved_by_director_at` | `timestamptz` | Data zatwierdzenia przez Dyrektora |
| `uploaded_by` | `uuid` | ID użytkownika który dodał fakturę |

## Testowanie

### Test 1: Specjalista wysyła fakturę

1. Zaloguj się jako Specjalista
2. Dodaj nową fakturę i wyślij do weryfikacji
3. **Oczekiwany wynik**: Widzisz status "W weryfikacji"
4. Zaloguj się jako Kierownik z tego działu
5. **Oczekiwany wynik**: Widzisz status "Oczekujące"

### Test 2: Kierownik akceptuje fakturę w limitach

1. Zaloguj się jako Kierownik
2. Zaakceptuj fakturę która mieści się w limitach
3. **Oczekiwany wynik**: Status zmienia się na "Zaakceptowana"
4. Zaloguj się jako Specjalista (uploader)
5. **Oczekiwany wynik**: Widzisz status "Zaakceptowana"

### Test 3: Kierownik akceptuje fakturę poza limitami

1. Zaloguj się jako Kierownik
2. Zaakceptuj fakturę która przekracza limity
3. **Oczekiwany wynik**: Status zmienia się na "W weryfikacji" (dla Kierownika)
4. Zaloguj się jako Dyrektor
5. **Oczekiwany wynik**: Widzisz status "Oczekujące"

### Test 4: Filtry statusów

1. Zaloguj się jako Specjalista
2. Wyślij fakturę do weryfikacji
3. Użyj filtra "W weryfikacji"
4. **Oczekiwany wynik**: Widzisz swoją fakturę
5. Zaloguj się jako Kierownik
6. Użyj filtra "Oczekujące"
7. **Oczekiwany wynik**: Widzisz tę samą fakturę

## Najczęstsze Problemy

### Problem: Użytkownik nie widzi faktury w filtrze "Oczekujące"

**Diagnoza**:
- Sprawdź czy `current_approver_id` jest ustawione na ID tego użytkownika
- Sprawdź czy status faktury to `waiting`

```sql
SELECT id, invoice_number, status, current_approver_id, uploaded_by
FROM invoices
WHERE id = 'invoice-uuid';
```

### Problem: Wszyscy widzą fakturę jako "W weryfikacji"

**Diagnoza**:
- Sprawdź czy `current_approver_id` jest ustawione

```sql
SELECT id, invoice_number, status, current_approver_id
FROM invoices
WHERE status = 'waiting' AND current_approver_id IS NULL;
```

**Rozwiązanie**: Trigger `auto_assign_invoice_to_approver` powinien automatycznie ustawić `current_approver_id`. Jeśli nie działa, sprawdź logi.

## Changelog

### 2026-02-09
- Zaimplementowano system display statusów zależnych od perspektywy użytkownika
- Dodano funkcję `getUserSpecificStatus()` w komponentach
- Zaktualizowano filtry aby używały display statusów
- Dodano status "Opłacona" (`paid`)
- Zaktualizowano kolory statusów
- Dodano pola `current_approver_id`, `approved_by_manager_at`, `approved_by_director_at` do typów TypeScript
