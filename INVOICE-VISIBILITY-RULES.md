# Zasady Widoczności Faktur

## Podsumowanie Zmian

Zaktualizowano polityki RLS (Row Level Security) dla faktur, aby **Specjaliści widzieli tylko faktury które sami dodali**.

### Przed Zmianą
- Specjaliści widzieli wszystkie faktury ze swojego działu
- To mogło prowadzić do wycieku informacji między pracownikami

### Po Zmianie
- **Specjaliści**: widzą TYLKO faktury które sami dodali (`uploaded_by = ich ID`)
- **Kierownicy**: widzą wszystkie faktury w swoim dziale (własne + od Specjalistów)
- **Dyrektorzy**: widzą faktury ze swojego działu i wszystkich poddziałów
- **CEO**: widzi wszystkie faktury w systemie
- **Admini**: widzą faktury z działów do których mają dostęp

## Szczegółowe Zasady

### 1. Faktury Zwykłe (tabela `invoices`)

#### Specjalista
- Widzi TYLKO faktury gdzie `uploaded_by = auth.uid()`
- Nie widzi faktur dodanych przez Kierownika/Dyrektora
- Nie widzi faktur innych Specjalistów z tego samego działu

**Przykład:**
```
Dział IT:
- Kierownik (s.hoffman) dodał 16 faktur → Specjalista NIE widzi
- Specjalista (p.dudek) dodał 1 fakturę → Specjalista widzi TYLKO tę 1
```

#### Kierownik
- Widzi wszystkie faktury w swoim dziale
- Widzi faktury które sam dodał
- Widzi faktury dodane przez Specjalistów z jego działu
- Nie widzi faktur z innych działów

#### Dyrektor
- Widzi wszystkie faktury ze swojego działu
- Widzi wszystkie faktury ze wszystkich poddziałów (hierarchia)
- Widzi faktury które sam dodał

#### CEO
- Widzi wszystkie faktury w całym systemie
- Bez ograniczeń działowych

### 2. Faktury KSeF (tabela `ksef_invoices`)

#### Specjalista
- Widzi TYLKO faktury KSeF które sam pobrał (`fetched_by = auth.uid()`)
- Nie widzi faktur pobranych przez Kierownika/Dyrektora
- Nie widzi faktur pobranych przez innych Specjalistów

**Przykład:**
```
Dział IT:
- Kierownik (s.hoffman) pobrał 25 faktur KSeF → Specjalista NIE widzi
- Specjalista (p.dudek) pobrał 0 faktur KSeF → Specjalista widzi 0
```

#### Kierownik
- Widzi wszystkie faktury KSeF przypisane do swojego działu
- Widzi faktury KSeF które sam pobrał
- Widzi faktury KSeF pobrane przez innych użytkowników jeśli są przypisane do jego działu

#### Dyrektor
- Widzi faktury KSeF ze swojego działu i wszystkich poddziałów
- Hierarchia działów jest respektowana

#### CEO
- Widzi wszystkie faktury KSeF w systemie

### 3. Faktury Draft (szkice)

Faktury w statusie `draft` są ZAWSZE widoczne TYLKO dla osoby która je stworzyła, niezależnie od roli.

## Przypadki Użycia

### Scenariusz 1: Kierownik pobiera faktury z dysku/maila
1. Kierownik pobiera fakturę przez integrację Google Drive/Gmail
2. Faktura ma `uploaded_by = kierownik_id`
3. Specjaliści z tego działu **NIE WIDZĄ** tej faktury
4. Kierownik widzi tę fakturę

**Efekt:** Faktury pobrane przez Kierownika/Dyrektora są prywatne dla nich

### Scenariusz 2: Specjalista dodaje fakturę
1. Specjalista dodaje fakturę manualnie lub przez OCR
2. Faktura ma `uploaded_by = specjalista_id`
3. Specjalista widzi swoją fakturę
4. Kierownik widzi fakturę Specjalisty (ponieważ jest w jego dziale)
5. Inni Specjaliści **NIE WIDZĄ** tej faktury

**Efekt:** Każdy Specjalista widzi tylko swoje faktury, Kierownik widzi wszystkie

### Scenariusz 3: Dyrektor pobiera faktury z KSeF
1. Dyrektor pobiera faktury przez integrację KSeF
2. Faktury mają `fetched_by = dyrektor_id`
3. Faktury są przypisane do działu: `transferred_to_department_id = dział_id`
4. Specjaliści z tego działu **NIE WIDZĄ** faktur KSeF Dyrektora
5. Kierownik widzi faktury KSeF jeśli są przypisane do jego działu
6. Dyrektor widzi wszystkie swoje faktury KSeF

**Efekt:** Faktury KSeF pobrane przez Dyrektora/Kierownika nie są widoczne dla Specjalistów

## Implementacja Techniczna

### Polityka RLS dla `invoices`
```sql
CREATE POLICY "Users can view invoices based on role and department"
ON invoices FOR SELECT TO authenticated
USING (
  -- CEO widzi wszystkie
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Dyrektor widzi swój dział + poddziały
  (... rekurencyjna hierarchia działów ...)
  OR
  -- Kierownik widzi swój dział
  (... faktury z działu + od Specjalistów ...)
  OR
  -- Specjalista widzi TYLKO swoje
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND uploaded_by = auth.uid()
  )
);
```

### Polityka RLS dla `ksef_invoices`
```sql
CREATE POLICY "Users can view KSEF invoices based on role and department"
ON ksef_invoices FOR SELECT TO authenticated
USING (
  -- CEO widzi wszystkie
  (SELECT role FROM profiles WHERE id = auth.uid()) = 'CEO'
  OR
  -- Dyrektor widzi swój dział + poddziały
  (... rekurencyjna hierarchia działów ...)
  OR
  -- Kierownik widzi swój dział
  (... faktury przypisane do działu ...)
  OR
  -- Specjalista widzi TYLKO faktury które sam pobrał
  (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'Specjalista'
    AND fetched_by = auth.uid()
  )
);
```

## Testowanie

### Test 1: Specjalista widzi tylko swoje faktury
```sql
-- Zaloguj się jako Specjalista p.dudek
SELECT COUNT(*) FROM invoices;
-- Wynik: 1 (tylko TEST-SPEC-001 którą sam dodał)
```

### Test 2: Kierownik widzi faktury działu
```sql
-- Zaloguj się jako Kierownik s.hoffman
SELECT COUNT(*) FROM invoices WHERE department_id = 'IT';
-- Wynik: 17 (16 własnych + 1 od Specjalisty p.dudek)
```

### Test 3: Specjalista nie widzi faktur KSeF Kierownika
```sql
-- Zaloguj się jako Specjalista p.dudek
SELECT COUNT(*) FROM ksef_invoices;
-- Wynik: 0 (nie pobrał jeszcze żadnych)

-- Zaloguj się jako Kierownik s.hoffman
SELECT COUNT(*) FROM ksef_invoices;
-- Wynik: 25 (wszystkie które sam pobrał)
```

## Bezpieczeństwo

Polityki RLS są wymuszane na poziomie bazy danych, co oznacza:

- Niemożliwe jest obejście tych zasad z poziomu aplikacji
- Nawet jeśli ktoś zmodyfikuje frontend, nie zobaczy danych innych użytkowników
- API nie może zwrócić danych do których użytkownik nie ma dostępu
- Wszystkie zapytania SQL są automatycznie filtrowane przez PostgreSQL

## Migracja

Nazwa pliku: `fix_specialist_invoice_visibility_own_only.sql`

Data: 2026-02-09

Zmiany:
1. Usunięto konfliktującą politykę "Users can view invoices from their department or granted access"
2. Zaktualizowano politykę "Users can view invoices based on role and department"
3. Zaktualizowano politykę "Users can view KSEF invoices based on role and department"
4. Dodano sprawdzenie roli dla każdego użytkownika
5. Dodano ograniczenie dla Specjalistów: TYLKO `uploaded_by = auth.uid()` lub `fetched_by = auth.uid()`

## Weryfikacja w Produkcji

Po wdrożeniu sprawdź:

1. Zaloguj się jako Specjalista
   - Czy widzisz tylko swoje faktury?
   - Czy nie widzisz faktur Kierownika?
   - Czy nie widzisz faktur innych Specjalistów?

2. Zaloguj się jako Kierownik
   - Czy widzisz wszystkie faktury swojego działu?
   - Czy widzisz faktury dodane przez Specjalistów?

3. Zaloguj się jako Dyrektor
   - Czy widzisz faktury swojego działu i poddziałów?

4. Zaloguj się jako CEO
   - Czy widzisz wszystkie faktury?

## Kontakt

W razie problemów:
- Sprawdź polityki RLS: `SELECT * FROM pg_policies WHERE tablename IN ('invoices', 'ksef_invoices')`
- Sprawdź logi: Supabase Dashboard → Database → Logs
- Przetestuj widoczność dla konkretnego użytkownika
