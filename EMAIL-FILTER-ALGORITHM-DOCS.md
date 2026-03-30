# Dokumentacja Techniczna: Algorytm Filtracji Faktur z Emaila

## Przegląd

Algorytm jest w pełni lokalny - nie wymaga żadnego zewnętrznego AI ani API do klasyfikacji. Działa wyłącznie na podstawie analizy treści PDF i metadanych pliku. Każdy PDF przechodzi przez 5 warstw weryfikacji przed uznaniem go za fakturę.

---

## Architektura - 5 warstw filtracji

```
PDF załącznik z Gmaila
         │
         ▼
┌─────────────────────────┐
│  WARSTWA 1              │
│  Limit rozmiaru         │  > 1 MB → POMIŃ
└────────────┬────────────┘
             │ OK
             ▼
┌─────────────────────────┐
│  WARSTWA 2              │
│  Deduplikacja wstępna   │  filename + size w tym samym wątku → POMIŃ
└────────────┬────────────┘
             │ OK
             ▼
┌─────────────────────────┐
│  WARSTWA 3              │
│  Blacklista nazw +      │  Zabroniona nazwa pliku → POMIŃ
│  Analiza treści PDF     │  Brak tekstu (skan) → POMIŃ
│  (algorytm lokalny)     │  Brak słowa "faktura" na str. 1 → POMIŃ
│                         │  Brak kwoty pieniężnej → POMIŃ
└────────────┬────────────┘
             │ JEST FAKTURĄ
             ▼
┌─────────────────────────┐
│  WARSTWA 4              │
│  Deduplikacja przez     │  SHA-256 hash już istnieje → USUŃ i POMIŃ
│  hash + numer faktury   │  Numer faktury + NIP już istnieje → USUŃ i POMIŃ
└────────────┬────────────┘
             │ OK
             ▼
┌─────────────────────────┐
│  WARSTWA 5              │
│  OCR - klasyfikacja AI  │  Faktura wychodząca → USUŃ i POMIŃ
│  (przez process-ocr)    │  Hasło chroniony PDF → USUŃ i POMIŃ
└────────────┬────────────┘
             │ OK
             ▼
       FAKTURA ZAPISANA
```

---

## Warstwa 1: Limit rozmiaru

```typescript
const MAX_ATTACHMENT_BYTES = 1 * 1024 * 1024; // 1 MB

// Sprawdzenie przed pobieraniem (na podstawie metadanych Gmail)
if (part.body?.size && part.body.size > MAX_ATTACHMENT_BYTES) {
  // Pomiń bez pobierania - oszczędność transferu
  skip(reason: "too_large");
}

// Sprawdzenie po pobraniu (rzeczywisty rozmiar)
if (pdfData.length > MAX_ATTACHMENT_BYTES) {
  skip(reason: "too_large");
}
```

**Uzasadnienie:** Faktury to zazwyczaj proste dokumenty. Pliki > 1 MB to najprawdopodobniej katalogi, prezentacje lub skany wysokiej rozdzielczości, nie nadające się do przetwarzania OCR.

---

## Warstwa 2: Deduplikacja wstępna (przed pobraniem)

Wykonywana **przed** pobraniem pliku - oszczędza transfer danych.

```typescript
// Sprawdzenie: czy plik o tej samej nazwie i rozmiarze był już przetworzony
const { data: sameFileExists } = await supabase
  .from("processed_email_thread_files")
  .select("id")
  .eq("email_config_id", config.id)
  .eq("filename", part.filename)
  .eq("file_size", part.body.size)
  .limit(1)
  .maybeSingle();

if (sameFileExists) {
  skip(reason: "duplicate_filename_size");
}
```

**Co sprawdza:** Tabela `processed_email_thread_files` przechowuje `(email_config_id, thread_id, filename)` - unikalny klucz. To blokuje ten sam plik pojawiający się wielokrotnie w jednym wątku email (odpowiedzi, przekierowania).

---

## Warstwa 3: Lokalny algorytm klasyfikacji PDF

Główna logika filtracji. Funkcja `runLocalInvoiceFilter(base64Data, filename)`.

### Krok 3a: Blacklista nazw plików

```typescript
const HARD_SKIP_FILENAMES = [
  'newsletter',
  'brochure',
  'katalog',
  'catalog',
  'catalogue',
  'presentation',
  'prezentacja',
  'regulamin',
  'terms_and_conditions',
  'terms-and-conditions',
  'vendo.erp',
];

const fnLower = filename.toLowerCase();

for (const pattern of HARD_SKIP_FILENAMES) {
  if (fnLower.includes(pattern)) {
    return {
      isInvoice: false,
      rejectionReason: 'filename_excluded'
    };
  }
}
```

**Sprawdzenie:** Czy nazwa pliku (lowercase) zawiera którykolwiek z zabronionych ciągów. Dopasowanie częściowe - `moj_katalog_2024.pdf` zostanie odrzucony.

---

### Krok 3b: Ekstrakcja tekstu z PDF

```typescript
const pdfParse = await import('npm:pdf-parse@1.1.1');
const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));

// Pełny tekst dokumentu (wszystkie strony)
const pdfDataFull = await pdfParse.default(buffer);
const fullText = pdfDataFull?.text || '';
// Warunek: co najmniej 30 znaków tekstu → "nie jest skanem"

// Tekst tylko pierwszej strony
const pdfDataPage1 = await pdfParse.default(buffer, { max: 1 });
const firstPageText = pdfDataPage1?.text || '';
// Warunek: co najmniej 10 znaków → "pierwsza strona czytelna"
```

**Wykrywanie skanów:**

```typescript
const isScanned = fullText === null; // lub < 30 znaków

if (isScanned) {
  return {
    isInvoice: false,       // NIE traktuje się jako faktura...
    isScanned: true,        // ...ale oznacza się jako skan
    rejectionReason: 'scanned_no_text'
  };
}
```

Zeskanowane dokumenty są pomijane na etapie filtracji lokalnej. Nie trafiają do systemu przez ten przepływ emailowy - wymagałyby osobnego OCR-a z rozpoznawaniem obrazu.

---

### Krok 3c: Sprawdzenie słowa "faktura" na pierwszej stronie (WYMAGANE)

```typescript
const INVOICE_WORD_PATTERNS = [
  /\bfaktura\b/i,                         // Polski
  /\binvoice\b/i,                         // Angielski
  /\brechnung\b/i,                        // Niemiecki
  /\bfacture\b/i,                         // Francuski
  /\bfattura\b/i,                         // Włoski
  /\bfactura\b/i,                         // Hiszpański / Kataloński
  /\bfaktúra\b/i,                         // Słowacki / Czeski
  /\bszámla\b/i,                          // Węgierski
  /\bfatura\b/i,                          // Turecki / Portugalski
  /\bnota\s+(?:księgowa|korygująca)\b/i,   // Polski - nota korygująca
  /\bcredit\s+note\b/i,                   // Angielski - nota kredytowa
  /\bdebit\s+note\b/i,                    // Angielski - nota debetowa
  /\bproforma\b/i,                        // Proforma (wszystkie języki)
  /\bpro\s+forma\b/i,                     // Pro forma (z spacją)
];

// Sprawdzenie na tekście PIERWSZEJ strony (lub pełnym jeśli page1 niedostępny)
const page1Check = firstPageText ?? fullText;

if (!hasInvoiceWord(page1Check)) {
  return {
    isInvoice: false,
    rejectionReason: 'no_invoice_word_on_first_page'
  };
}
```

**Kluczowy szczegół:** Wzorce używają `\b` (word boundary) - granica słowa. Oznacza to:
- `faktura` - dopasuje "FAKTURA VAT", "Faktura nr 001"
- NIE dopasuje "fakturaX" ani "profaktura" (gdyby ktoś użył zlepu)
- Wyjątek: `proforma` i `pro\s+forma` - celowo bez `\b` na końcu, bo "proforma nr" jest OK

**Dlaczego tylko pierwsza strona?** Faktury zawsze mają tytuł "Faktura" lub "Invoice" na górze pierwszej strony. Jeśli tego słowa nie ma na str. 1, dokument prawie na pewno nie jest fakturą (może być regulaminem, umową, ofertą itp.).

---

### Krok 3d: Sprawdzenie kwoty pieniężnej (WYMAGANE)

```typescript
const AMOUNT_PATTERNS = [
  // Format: liczba + waluta (po prawej)
  /\d[\d\s]*[,.]\d{2}\s*(pln|eur|usd|gbp|chf|czk|huf|sek|nok|dkk)/i,
  // Format: liczba + symbol waluty (po prawej)
  /\d[\d\s]*[,.]\d{2}\s*(zł|€|\$|£)/i,
  // Format: waluta + liczba (po lewej)
  /(pln|eur|usd|gbp|zł|€|\$|£)\s*\d[\d\s]*[,.]\d{2}/i,
  // Format europejski z separatorem tysięcy: "1 234,56"
  /\d+[\s\u00a0]?\d{3}[,.]\d{2}/,
];
```

Sprawdzenie wykonywane na **całym dokumencie** (nie tylko pierwszej stronie).

**Obsługiwane waluty:**
- Nazwy: PLN, EUR, USD, GBP, CHF, CZK, HUF, SEK, NOK, DKK
- Symbole: zł, €, $, £

**Obsługiwane formaty liczb:**

| Format | Przykład | Dopasowanie |
|--------|---------|-------------|
| Polski/europejski | 1 234,56 PLN | wzorzec 1 |
| Angielski | 1,234.56 USD | wzorzec 1 (przecinek jako separator) |
| Symbol po | 1234.56 € | wzorzec 2 |
| Symbol przed | €1234.56 | wzorzec 3 |
| Europejski z spacją | 1 234,56 | wzorzec 4 (unicode no-break space) |

---

### Wyniki warstwy 3

| Scenariusz | `isInvoice` | `isScanned` | `rejectionReason` |
|-----------|------------|------------|-------------------|
| Zakazana nazwa pliku | `false` | `false` | `filename_excluded` |
| Skan (brak tekstu) | `false` | `true` | `scanned_no_text` |
| Brak słowa faktury na str. 1 | `false` | `false` | `no_invoice_word_on_first_page` |
| Brak kwoty | `false` | `false` | `no_monetary_amount` |
| Wszystko OK | `true` | `false` | - |

---

## Warstwa 4: Deduplikacja po treści

Wykonywana po pobraniu i ekstrakcji hash. Trzy sprawdzenia:

### 4a: Hash SHA-256 w tej samej sesji

```typescript
const seenHashesThisChunk = new Set<string>();

if (seenHashesThisChunk.has(fileHash)) {
  skip(reason: "duplicate");
}
seenHashesThisChunk.add(fileHash);
```

Zapobiega duplikatom w obrębie jednego chunk'a (ten sam plik w różnych wiadomościach tej samej partii).

### 4b: Hash SHA-256 w bazie danych

```typescript
const { data: existingInvoice } = await supabase
  .from("invoices")
  .select("id")
  .eq("file_hash", fileHash)
  .eq("uploaded_by", userId)
  .maybeSingle();

if (existingInvoice) {
  skip(reason: "duplicate");
}
```

Zapobiega importowaniu tego samego pliku, który już jest w systemie (np. z poprzedniej synchronizacji).

### 4c: Thread ID + nazwa pliku

```typescript
const { data: threadFileExists } = await supabase
  .from("processed_email_thread_files")
  .select("id")
  .eq("email_config_id", config.id)
  .eq("thread_id", threadId)
  .eq("filename", part.filename)
  .maybeSingle();

if (threadFileExists) {
  skip(reason: "duplicate");
}
```

Obsługuje przypadek: ten sam PDF pojawia się w kolejnych wiadomościach tego samego wątku (reply z załącznikiem, forward itp.).

---

## Warstwa 5: Klasyfikacja AI przez OCR

Po zapisaniu faktury do bazy, OCR weryfikuje dokument głębiej. Dwa przypadki prowadzą do **cofnięcia** (delete invoice + delete storage):

### 5a: Faktura wychodząca

```typescript
if (ocrData.isOutgoingInvoice) {
  await supabase.from("invoices").delete().eq("id", invoiceData.id);
  await supabase.storage.from("documents").remove([filePath]);
  skip(reason: "outgoing_invoice");
}
```

OCR identyfikuje faktury wystawione przez samego użytkownika (sprzedażowe). System obsługuje tylko faktury zakupowe (przychodzące).

### 5b: Plik chroniony hasłem

```typescript
if (ocrData.passwordProtected) {
  await supabase.from("invoices").delete().eq("id", invoiceData.id);
  await supabase.storage.from("documents").remove([filePath]);
  skip(reason: "password_protected");
}
```

### 5c: Duplikat po numerze faktury (po OCR)

```typescript
if (!job.force_reimport && d.invoice_number && (d.supplier_nip || d.supplier_name)) {
  const { data: existingByNumber } = await supabase
    .from("invoices")
    .select("id")
    .eq("invoice_number", d.invoice_number)
    .neq("id", invoiceData.id)
    // + warunek na NIP jeśli dostępny
    .maybeSingle();

  if (existingByNumber) {
    await supabase.from("invoices").delete().eq("id", invoiceData.id);
    skip(reason: "duplicate");
  }
}
```

Sprawdzenie: czy faktura o tym samym numerze i tym samym dostawcy (NIP) już istnieje w systemie.

---

## Zdarzenia SSE emitowane podczas filtracji

Gdy sync działa w trybie `?stream=1`, każdy krok algorytmu emituje zdarzenie:

| Typ zdarzenia | Kiedy | Dane |
|--------------|-------|------|
| `filter_start` | Przed uruchomieniem filtru | `{ filename }` |
| `filter_passed` | Algorytm uznał plik za fakturę | `{ filename, confidence: 1.0, isScanned: false }` |
| `attachment_skipped` | Plik odrzucony | `{ filename, reason, filterReason, filterDetails }` |
| `invoice_created` | Faktura zapisana w bazie | `{ filename, invoiceId }` |
| `ocr_start` | Rozpoczęcie OCR | `{ filename }` |
| `ocr_done` | OCR zakończony | `{ filename }` |

**Kody `reason` przy pominięciu:**

| Kod | Opis |
|-----|------|
| `too_large` | Plik > 1 MB |
| `duplicate_filename_size` | Taka sama nazwa + rozmiar w tym wątku |
| `duplicate` | Duplikat (hash, numer faktury lub wątek) |
| `not_invoice_filter` | Odrzucony przez algorytm lokalny |
| `outgoing_invoice` | Faktura wychodząca (OCR) |
| `password_protected` | PDF chroniony hasłem (OCR) |

---

## Kompletny przepływ decyzyjny (pseudokod)

```
function processPdfAttachment(attachment):

  // WARSTWA 1
  if attachment.size > 1MB:
    emit("attachment_skipped", reason="too_large")
    return

  // WARSTWA 2 (przed pobraniem)
  if existsInThreadFiles(attachment.filename, attachment.size):
    emit("attachment_skipped", reason="duplicate_filename_size")
    return

  pdfBytes = downloadAttachment(attachment)

  if pdfBytes.length > 1MB:
    emit("attachment_skipped", reason="too_large")
    return

  hash = sha256(pdfBytes)

  // WARSTWA 4a i 4b (po pobraniu, przed filtrem)
  if seenHashesThisChunk.has(hash) OR existsInvoiceWithHash(hash):
    emit("attachment_skipped", reason="duplicate")
    return

  if existsThreadFile(threadId, attachment.filename):
    emit("attachment_skipped", reason="duplicate")
    return

  // WARSTWA 3 - algorytm lokalny
  filterResult = runLocalInvoiceFilter(pdfBytes, attachment.filename)

  // 3a: blacklista nazw
  if attachment.filename zawiera zakazane słowo:
    emit("attachment_skipped", reason="not_invoice_filter", filterReason="filename_excluded")
    return

  // 3b: ekstrakcja tekstu
  fullText, firstPageText = extractTextFromPdf(pdfBytes)

  if fullText == null or fullText.length < 30:
    emit("attachment_skipped", reason="not_invoice_filter", filterReason="scanned_no_text")
    return

  // 3c: słowo "faktura" na str. 1
  if NOT hasInvoiceWord(firstPageText):
    emit("attachment_skipped", reason="not_invoice_filter", filterReason="no_invoice_word_on_first_page")
    return

  // 3d: kwota pieniężna w całym dokumencie
  if NOT hasMonetaryAmount(fullText):
    emit("attachment_skipped", reason="not_invoice_filter", filterReason="no_monetary_amount")
    return

  // PLIK PRZESZEDŁ FILTR - zapisz do bazy
  emit("filter_passed", confidence=1.0)
  invoice = saveInvoice(pdfBytes)
  seenHashesThisChunk.add(hash)
  recordThreadFile(threadId, attachment.filename)

  // WARSTWA 5 - OCR (async)
  ocrResult = callOcrFunction(invoice.id)

  if ocrResult.isOutgoingInvoice:
    deleteInvoice(invoice.id)
    emit("attachment_skipped", reason="outgoing_invoice")
    return

  if ocrResult.passwordProtected:
    deleteInvoice(invoice.id)
    emit("attachment_skipped", reason="password_protected")
    return

  // WARSTWA 4c - duplikat po numerze faktury
  if ocrResult.invoice_number AND existsInvoiceWithNumber(ocrResult.invoice_number):
    deleteInvoice(invoice.id)
    emit("attachment_skipped", reason="duplicate")
    return

  emit("ocr_done")
  // Faktura zaimportowana pomyślnie
```

---

## Ograniczenia algorytmu

1. **Skany są odrzucane** - PDF skanowany (zdjęcie bez tekstu) nie przejdzie przez warstwę 3b. Wymaga oddzielnego przepływu z OCR opartym na rozpoznawaniu obrazu (np. Tesseract, Google Vision).

2. **Limit 1 MB** - duże faktury z grafikami lub wielostronicowe mogą być odrzucane. Można to zmienić modyfikując `MAX_ATTACHMENT_BYTES`.

3. **Tylko języki z listy** - wzorce `INVOICE_WORD_PATTERNS` obsługują 9 języków. Dokument np. po japońsku nie zostanie rozpoznany jako faktura (chyba że zawiera angielskie słowo "invoice").

4. **Kwoty bez waluty** - liczba `1234,56` bez oznaczenia waluty NIE jest dopasowywana przez wzorce 1-3. Dopasowuje ją tylko wzorzec 4 (format europejski z separatorem tysięcy).

5. **`force_reimport` wyłącza warstwy 2, 4a, 4b, 4c** - przy reimporcie ze wskazanym zakresem dat deduplikacja jest wyłączona, więc ta sama faktura może zostać zaimportowana ponownie.
