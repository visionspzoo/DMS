# Integracja KSeF API z bolt.new

## Informacje o API

KSeF Invoice API umożliwia pobieranie faktur z Krajowego Systemu e-Faktur (KSeF) w formatach PDF (base64) i JSON.

**Adres bazowy:** `https://ksef-invoice-fetcher-auraherbals.replit.app`  
**NIP:** `5851490834`

## Uwierzytelnianie

Każde zapytanie wymaga nagłówka `x-api-key`:

```
x-api-key: TWOJ_KLUCZ_API
```

---

## Dostępne endpointy

### 1. Lista faktur

```
GET /api/external/invoices?dateFrom=2025-12-01&dateTo=2026-02-12&subjectType=subject2&invoiceType=all&pageSize=50&pageOffset=0
```

**Parametry query:**
| Parametr | Typ | Domyślnie | Opis |
|---|---|---|---|
| `dateFrom` | string (YYYY-MM-DD) | wymagany | Data początkowa |
| `dateTo` | string (YYYY-MM-DD) | wymagany | Data końcowa |
| `subjectType` | string | `subject2` | `subject1` = sprzedaż, `subject2` = zakupy |
| `invoiceType` | string | `all` | `all`, `VAT`, `KOR`, `ZAL` |
| `pageSize` | number | `25` | 10-250 |
| `pageOffset` | number | `0` | Przesunięcie paginacji |

**Odpowiedź:**
```json
{
  "success": true,
  "data": {
    "invoices": [
      {
        "ksefNumber": "5252674798-20260202-D70460CBDF5F-32",
        "invoiceNumber": "00084469/PL/N/PLN/2026/01",
        "issueDate": "2026-02-02",
        "invoicingDate": "2026-02-02",
        "acquisitionDate": "2026-02-02T13:45:22.123Z",
        "seller": {
          "nip": "5252674798",
          "name": "Allegro sp. z o.o."
        },
        "buyer": {
          "identifier": { "type": "NIP", "value": "5851490834" },
          "name": "AURA HERBALS SP. Z O.O."
        },
        "netAmount": 1500.00,
        "vatAmount": 345.00,
        "grossAmount": 1845.00,
        "currency": "PLN",
        "invoiceType": "VAT",
        "hasAttachment": false,
        "isSelfInvoicing": false
      }
    ],
    "numberOfElements": 41,
    "hasMore": false,
    "pageSize": 50,
    "pageOffset": 0
  }
}
```

---

### 2. Szczegóły faktury (dane sparsowane)

```
GET /api/external/invoices/{ksefNumber}
```

**Odpowiedź:** Pełne dane faktury z pozycjami, danymi sprzedawcy/nabywcy, kwotami, adnotacjami.

---

### 3. Faktura PDF jako base64

```
GET /api/external/invoices/{ksefNumber}/pdf-base64
```

**Odpowiedź:**
```json
{
  "success": true,
  "data": {
    "ksefNumber": "5252674798-20260202-D70460CBDF5F-32",
    "fileName": "faktura-5252674798-20260202-D70460CBDF5F-32.pdf",
    "mimeType": "application/pdf",
    "base64": "JVBERi0xLjQKMSAwIG9iago8PAovVHlwZS...",
    "sizeBytes": 45230
  },
  "meta": {
    "requestedAt": "2026-02-12T12:00:00.000Z",
    "format": "base64"
  }
}
```

**Jak użyć base64 w bolt.new:**

```javascript
// Pobranie PDF jako base64
const response = await fetch(
  `${API_URL}/api/external/invoices/${ksefNumber}/pdf-base64`,
  { headers: { 'x-api-key': API_KEY } }
);
const { data } = await response.json();

// Wyświetlenie PDF w przeglądarce
const pdfUrl = `data:${data.mimeType};base64,${data.base64}`;
window.open(pdfUrl);

// Pobranie jako plik
const link = document.createElement('a');
link.href = pdfUrl;
link.download = data.fileName;
link.click();

// Osadzenie w iframe
const iframe = document.getElementById('pdf-viewer');
iframe.src = pdfUrl;

// Konwersja base64 na Blob (do wysyłki na serwer itp.)
const byteCharacters = atob(data.base64);
const byteNumbers = new Array(byteCharacters.length);
for (let i = 0; i < byteCharacters.length; i++) {
  byteNumbers[i] = byteCharacters.charCodeAt(i);
}
const byteArray = new Uint8Array(byteNumbers);
const blob = new Blob([byteArray], { type: data.mimeType });
```

---

### 4. Status serwisu

```
GET /api/external/status
```

Sprawdza czy serwis działa i czy sesja KSeF jest aktywna.

---

## Przykład integracji w bolt.new

### Komponent React do pobierania faktur PDF

```jsx
import { useState } from 'react';

const API_URL = 'https://ksef-invoice-fetcher-auraherbals.replit.app';
const API_KEY = 'TWOJ_KLUCZ_API';

function InvoicePdfDownloader({ ksefNumber }) {
  const [loading, setLoading] = useState(false);

  const downloadPdf = async () => {
    setLoading(true);
    try {
      const res = await fetch(
        `${API_URL}/api/external/invoices/${encodeURIComponent(ksefNumber)}/pdf-base64`,
        { headers: { 'x-api-key': API_KEY } }
      );
      const json = await res.json();
      
      if (!json.success) throw new Error(json.error);
      
      const link = document.createElement('a');
      link.href = `data:${json.data.mimeType};base64,${json.data.base64}`;
      link.download = json.data.fileName;
      link.click();
    } catch (err) {
      alert('Blad pobierania: ' + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <button onClick={downloadPdf} disabled={loading}>
      {loading ? 'Pobieranie...' : 'Pobierz PDF'}
    </button>
  );
}
```

### Serwis do pobierania listy faktur

```javascript
const API_URL = 'https://ksef-invoice-fetcher-auraherbals.replit.app';
const API_KEY = 'TWOJ_KLUCZ_API';

async function fetchInvoices(dateFrom, dateTo) {
  const params = new URLSearchParams({
    dateFrom,
    dateTo,
    subjectType: 'subject2',
    invoiceType: 'all',
    pageSize: '50',
    pageOffset: '0',
  });
  
  const res = await fetch(
    `${API_URL}/api/external/invoices?${params}`,
    { headers: { 'x-api-key': API_KEY } }
  );
  const json = await res.json();
  
  if (!json.success) throw new Error(json.error);
  return json.data;
}

async function getInvoicePdfBase64(ksefNumber) {
  const res = await fetch(
    `${API_URL}/api/external/invoices/${encodeURIComponent(ksefNumber)}/pdf-base64`,
    { headers: { 'x-api-key': API_KEY } }
  );
  const json = await res.json();
  
  if (!json.success) throw new Error(json.error);
  return json.data; // { ksefNumber, fileName, mimeType, base64, sizeBytes }
}
```

---

## Kody bledow

| Kod | Opis |
|---|---|
| `UNAUTHORIZED` | Brak lub nieprawidlowy klucz API |
| `API_KEY_NOT_CONFIGURED` | Klucz API nie skonfigurowany na serwerze |
| `FETCH_ERROR` | Blad komunikacji z KSeF API |
| `PDF_BASE64_ERROR` | Blad generowania PDF base64 |

## Format bledu

```json
{
  "success": false,
  "error": "Opis bledu",
  "code": "KOD_BLEDU"
}
```
