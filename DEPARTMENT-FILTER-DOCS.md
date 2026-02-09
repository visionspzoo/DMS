# Dokumentacja Filtrowania Działów

## Podsumowanie

Zaimplementowano inteligentne filtrowanie działów w interfejsie użytkownika na podstawie:
- Roli użytkownika (CEO, Dyrektor, Kierownik, Specjalista, Admin)
- Uprawnień z tabeli `user_department_access`
- Hierarchii działów

## Problem

Wcześniej wszyscy użytkownicy (w tym Specjaliści) widzieli wszystkie działy w systemie podczas filtrowania faktur, co:
- Naruszało zasady bezpieczeństwa
- Umożliwiało zobaczenie działów do których użytkownik nie ma dostępu
- Wprowadzało zamieszanie (użytkownik widział działy których faktury nie może zobaczyć)

## Rozwiązanie

### Nowa Funkcja: `getAccessibleDepartments()`

Utworzono funkcję pomocniczą w `src/lib/departmentUtils.ts`:

```typescript
export async function getAccessibleDepartments(
  profile: Profile | null
): Promise<AccessibleDepartment[]>
```

### Zasady Dostępu

#### 1. CEO
- Widzi **wszystkie działy** w systemie
- Bez ograniczeń

#### 2. Admin (is_admin = true)
- Zawsze widzi **wszystkie działy** w systemie
- Bez ograniczeń (podobnie jak CEO)
- Wpisy w `user_department_access` nie wpływają na widoczność działów w filtrach

**Uwaga:** `user_department_access` jest używany do innych celów (workflow, specjalne uprawnienia), ale nie ogranicza widoczności działów dla adminów w filtrach.

#### 3. Dyrektor
- Widzi swój dział (`department_id`)
- Widzi wszystkie poddziały (hierarchia)
- Używa funkcji `get_department_hierarchy(dept_id)`

**Przykład:**
```
Dyrektor działu "Produkcja":
→ Widzi: Produkcja, Magazyn, Jakość (poddziały)
```

#### 4. Kierownik
- Sprawdza czy ma dodatkowe działy w `user_department_access`
- Jeśli TAK: widzi swój dział + przypisane działy
- Jeśli NIE: widzi tylko swój dział

**Przykład:**
```sql
-- Kierownik IT z dostępem do działu HR
INSERT INTO user_department_access (user_id, department_id, access_type)
VALUES ('kierownik-uuid', 'HR-dept-uuid', 'view');

-- Kierownik widzi: IT (swój dział), HR (przypisany)
```

#### 5. Specjalista
- Sprawdza czy ma przypisane działy w `user_department_access`
- Jeśli TAK: widzi swój dział + przypisane działy
- Jeśli NIE: widzi tylko swój dział

**Przykład:**
```sql
-- Specjalista IT bez dodatkowych uprawnień
-- Widzi tylko: IT

-- Specjalista IT z dostępem do działu Marketing
INSERT INTO user_department_access (user_id, department_id, access_type)
VALUES ('specjalista-uuid', 'Marketing-dept-uuid', 'view');

-- Widzi: IT, Marketing
```

## Zaktualizowane Komponenty

### 1. InvoiceListPage.tsx
- Filtry działów pokazują tylko dostępne działy
- Specjalista nie widzi działów do których nie ma dostępu

**Przed:**
```typescript
const { data, error } = await supabase
  .from('departments')
  .select('name')
  .order('name');
// Wszystkie działy
```

**Po:**
```typescript
const accessibleDepts = await getAccessibleDepartments(userProfile);
setAvailableDepartments(accessibleDepts.map(d => d.name));
// Tylko dostępne działy
```

### 2. KSEFInvoicesPage.tsx
- Dropdown wyboru działu przy przekazywaniu faktur KSeF
- Pokazuje tylko działy do których użytkownik ma dostęp

**Przed:**
```typescript
const { data: allDepts, error } = await supabase
  .from('departments')
  .select('id, name')
  .order('name');
// Wszystkie działy
```

**Po:**
```typescript
const accessibleDepts = await getAccessibleDepartments(profile);
setDepartments(accessibleDepts);
// Tylko dostępne działy
```

### 3. InvoiceDetails.tsx
- Dropdown wyboru działu przy edycji faktury
- Pokazuje tylko działy do których użytkownik ma dostęp

**Przed:**
```typescript
const { data: allDepts, error } = await supabase
  .from('departments')
  .select('id, name')
  .order('name');
// + skomplikowana logika filtrowania
```

**Po:**
```typescript
const accessibleDepts = await getAccessibleDepartments(profile);
setAvailableDepartments(accessibleDepts);
// Prosta, spójna logika
```

### 4. UserInvitations.tsx
- Dropdown wyboru działu przy wysyłaniu zaproszenia
- Admin widzi tylko działy do których ma dostęp

**Przed:**
```typescript
const { data, error } = await supabase
  .from('departments')
  .select('id, name')
  .order('name');
// Wszystkie działy
```

**Po:**
```typescript
const accessibleDepts = await getAccessibleDepartments(profile);
setDepartments(accessibleDepts);
// Tylko dostępne działy
```

## Przyznawanie Dostępu do Działów

### Interfejs Użytkownika

W panelu Ustawienia → Zarządzanie Użytkownikami istnieje sekcja:
**"Dostęp do działów - Przyznaj użytkownikowi dostęp do faktur wybranych działów"**

Admin może przyznać dostęp do działów:
- **view**: Dostęp do przeglądania faktur
- **workflow**: Dostęp do workflow (akceptacja faktur)

### SQL

```sql
-- Przyznaj Specjaliście dostęp do działu Marketing
INSERT INTO user_department_access (user_id, department_id, access_type)
VALUES
  ('specjalista-uuid', 'marketing-dept-uuid', 'view');

-- Przyznaj Kierownikowi dostęp workflow do działu HR
INSERT INTO user_department_access (user_id, department_id, access_type)
VALUES
  ('kierownik-uuid', 'hr-dept-uuid', 'workflow');
```

## Testowanie

### Test 1: Specjalista IT bez dodatkowych uprawnień

**Kroki:**
1. Zaloguj się jako Specjalista IT (p.dudek)
2. Przejdź do Faktury → Filtr działów
3. Sprawdź dostępne działy

**Oczekiwany wynik:**
- Widoczny tylko dział: IT

### Test 2: Specjalista IT z dostępem do HR

**Kroki:**
1. Przyznaj dostęp:
```sql
INSERT INTO user_department_access (user_id, department_id, access_type)
SELECT
  '6833bff8-7462-4321-bad8-2f028117e4cf', -- p.dudek
  id,
  'view'
FROM departments WHERE name = 'HR';
```
2. Zaloguj się jako p.dudek
3. Sprawdź filtry działów

**Oczekiwany wynik:**
- Widoczne działy: IT, HR

### Test 3: Kierownik IT

**Kroki:**
1. Zaloguj się jako Kierownik IT (s.hoffman)
2. Sprawdź filtry działów

**Oczekiwany wynik:**
- Widoczny tylko dział: IT (lub IT + przypisane działy jeśli istnieją w user_department_access)

### Test 4: Dyrektor

**Kroki:**
1. Zaloguj się jako Dyrektor działu z poddziałami
2. Sprawdź filtry działów

**Oczekiwany wynik:**
- Widoczny dział główny + wszystkie poddziały

### Test 5: CEO

**Kroki:**
1. Zaloguj się jako CEO
2. Sprawdź filtry działów

**Oczekiwany wynik:**
- Widoczne wszystkie działy w systemie

### Test 6: Admin

**Kroki:**
1. Stwórz admina:
```sql
UPDATE profiles
SET is_admin = true
WHERE email = 'admin@example.com';
```
2. Zaloguj się jako admin
3. Sprawdź filtry działów

**Oczekiwany wynik:**
- Widoczne wszystkie działy w systemie (podobnie jak CEO)

## Bezpieczeństwo

### Poziom Aplikacji (Frontend)
- Filtry pokazują tylko dostępne działy
- Użytkownik nie może wybrać działu do którego nie ma dostępu

### Poziom Bazy Danych (RLS)
- Polityki RLS zapewniają że użytkownik nie zobaczy faktur z działów do których nie ma dostępu
- Nawet jeśli ktoś obejdzie frontend, RLS w PostgreSQL zabezpiecza dane

**Przykład polityki RLS:**
```sql
CREATE POLICY "Users can view invoices based on role and department"
ON invoices FOR SELECT TO authenticated
USING (
  -- CEO widzi wszystkie
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Specjalista widzi TYLKO swoje
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND uploaded_by = auth.uid()
  )
  -- ... inne warunki
);
```

## Hierarchia Działów

Funkcja `get_department_hierarchy(dept_id)` zwraca dział i wszystkie jego poddziały:

```sql
-- Przykład: Dział "Produkcja" z poddziałami
SELECT * FROM get_department_hierarchy('produkcja-uuid');

-- Wynik:
-- department_id              | level
-- ---------------------------+-------
-- produkcja-uuid             | 0      (główny dział)
-- magazyn-uuid               | 1      (poddział)
-- jakosc-uuid                | 1      (poddział)
```

Dyrektor widzi wszystkie te działy.

## Migracje

Nie wymagane żadne nowe migracje. Zmiany dotyczą tylko warstwy aplikacji (TypeScript/React).

Tabela `user_department_access` już istnieje i działa poprawnie.

## Dokumentacja API

### `getAccessibleDepartments(profile)`

**Parametry:**
- `profile: Profile | null` - profil użytkownika z bazy danych

**Zwraca:**
- `Promise<AccessibleDepartment[]>` - lista działów dostępnych dla użytkownika

**Przykład użycia:**
```typescript
import { getAccessibleDepartments } from '../../lib/departmentUtils';

const loadDepartments = async () => {
  if (!profile) return;

  const accessibleDepts = await getAccessibleDepartments(profile);
  setDepartments(accessibleDepts);
};
```

### `hasAccessToDepartment(profile, departmentId)`

**Parametry:**
- `profile: Profile | null` - profil użytkownika
- `departmentId: string` - UUID działu

**Zwraca:**
- `Promise<boolean>` - czy użytkownik ma dostęp do działu

**Przykład użycia:**
```typescript
const canAccess = await hasAccessToDepartment(profile, deptId);
if (canAccess) {
  // Pokaż dane działu
}
```

## Rozwiązywanie Problemów

### Problem: Specjalista nie widzi żadnych działów

**Diagnoza:**
```sql
SELECT
  p.email,
  p.department_id,
  d.name as department_name
FROM profiles p
LEFT JOIN departments d ON d.id = p.department_id
WHERE p.email = 'specjalista@example.com';
```

**Rozwiązanie:**
- Upewnij się że użytkownik ma przypisany `department_id`
- Lub przyznaj dostęp przez `user_department_access`

### Problem: Dyrektor widzi tylko swój dział (bez poddziałów)

**Diagnoza:**
```sql
SELECT * FROM get_department_hierarchy(
  (SELECT department_id FROM profiles WHERE email = 'dyrektor@example.com')
);
```

**Rozwiązanie:**
- Sprawdź czy poddziały mają poprawnie ustawiony `parent_department_id`
- Upewnij się że funkcja `get_department_hierarchy` działa

### Problem: Admin nie widzi wszystkich działów

**Diagnoza:**
```sql
SELECT is_admin
FROM profiles
WHERE email = 'admin@example.com';
```

**Rozwiązanie:**
- Upewnij się że `is_admin = true` w tabeli profiles
- Admin zawsze widzi wszystkie działy, niezależnie od `user_department_access`

## Kontakt i Wsparcie

W razie problemów:
1. Sprawdź logi przeglądarki (Console)
2. Sprawdź czy funkcja `getAccessibleDepartments` zwraca oczekiwane działy
3. Sprawdź polityki RLS w bazie danych
4. Zweryfikuj dane w `user_department_access`

## Changelog

### 2026-02-09 (Update 2)
- Naprawiono: Admin teraz zawsze widzi wszystkie działy (bez ograniczeń)
- Naprawiono: Użytkownicy z przypisanym department_id teraz widzą swój dział w filtrach
- Dodano pole `department_id` do interface Profile w AuthContext
- Uproszczono funkcję loadDepartments w InvoiceListPage (używa profile z AuthContext)

### 2026-02-09 (Initial)
- Utworzono funkcję `getAccessibleDepartments()` w `departmentUtils.ts`
- Zaktualizowano komponenty: InvoiceListPage, KSEFInvoicesPage, InvoiceDetails, UserInvitations
- Dodano inteligentne filtrowanie działów na podstawie roli i uprawnień
- Naprawiono problem: Specjalista widział wszystkie działy w filtrach
