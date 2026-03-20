import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OCRRequest {
  fileUrl?: string;
  invoiceId: string;
  pdfBase64?: string;
  fileBase64?: string;
  mimeType?: string;
  skipFilter?: boolean;
}

// ─────────────────────────────────────────────
// STEP 1: EXTRACT TEXT WITHOUT AI
// ─────────────────────────────────────────────

async function extractTextFromPdf(base64Data: string): Promise<string | null> {
  try {
    const pdfParse = await import('npm:pdf-parse@1.1.1');
    const buffer = Uint8Array.from(atob(base64Data), (c) => c.charCodeAt(0));
    const pdfData = await (pdfParse as any).default(buffer);
    const text = pdfData?.text || '';
    if (text.trim().length < 30) return null;
    return text;
  } catch (e: any) {
    console.error('pdf-parse failed:', e?.message || e);
    return null;
  }
}

interface ExtractedRawData {
  text: string | null;
  isScanned: boolean;
  mimeType: string;
  base64: string;
}

async function extractRawData(base64Data: string, mimeType: string): Promise<ExtractedRawData> {
  const isPDF = mimeType === 'application/pdf';

  if (isPDF) {
    const text = await extractTextFromPdf(base64Data);
    return {
      text,
      isScanned: text === null,
      mimeType,
      base64: base64Data,
    };
  }

  return {
    text: null,
    isScanned: false,
    mimeType,
    base64: base64Data,
  };
}

// ─────────────────────────────────────────────
// STEP 2: INVOICE FILTER ALGORITHM (NO AI)
// Algorytm filtracji — rozwijać o kolejne zmienne
// ─────────────────────────────────────────────

interface FilterResult {
  isInvoice: boolean;
  confidence: number;
  reasons: string[];
  rejectionReason?: string;
}

const INVOICE_KEYWORDS_STRONG = [
  // Polish
  'faktura vat', 'faktura nr', 'faktura pro', 'faktura korygująca',
  'faktura końcowa', 'faktura zaliczkowa', 'faktura', 'rachunek',
  'nota księgowa', 'nota korygująca',
  // Universal
  'invoice', 'invoice no', 'invoice number', 'inv no',
  'receipt', 'tax receipt', 'official receipt',
  // German
  'rechnung', 'rechnungsnummer', 'quittung',
  // French
  'facture', 'numéro de facture', 'reçu',
  // Italian
  'fattura', 'ricevuta',
  // Spanish
  'factura', 'recibo',
  // Dutch
  'factuur',
  // Swedish / Norwegian / Danish
  'faktura',
];

const INVOICE_KEYWORDS_MEDIUM = [
  'nip', 'vat', 'brutto', 'netto', 'gross', 'net amount',
  'tax', 'podatek', 'vat rate', 'stawka vat',
  'płatność', 'zapłata', 'payment', 'due date', 'termin płatności',
  'sprzedawca', 'nabywca', 'seller', 'buyer', 'bill to',
  'suma', 'razem', 'total', 'subtotal', 'amount due',
  'data wystawienia', 'issue date', 'data sprzedaży',
  'konto bankowe', 'bank account', 'iban', 'swift',
  'proforma', 'pro forma',
  'credit note', 'debit note',
];

const EXCLUDE_KEYWORDS = [
  'newsletter', 'unsubscribe', 'wypisz się', 'zapisz się',
  'regulamin', 'terms and conditions', 'privacy policy',
  'polityka prywatności',
  'oferta handlowa', 'oferta cenowa', 'oferta specjalna', 'oferta',
  'katalog', 'brochure',
  'offer letter', 'price offer', 'quotation', 'quote',
  'wycena', 'zapytanie ofertowe', 'zapytanie o wycenę',
  'kosztorys',
];

const AMOUNT_PATTERNS = [
  /\d[\d\s]*[,.]\d{2}\s*(pln|eur|usd|gbp|chf|czk|huf)/i,
  /\d[\d\s]*[,.]\d{2}\s*(zł|€|\$|£)/i,
  /(pln|eur|usd|gbp|zł)\s*\d[\d\s]*[,.]\d{2}/i,
];

const NIP_PATTERN = /\b\d{3}[-\s]?\d{3}[-\s]?\d{2}[-\s]?\d{2}\b|\b\d{10}\b/;
const DATE_PATTERN = /\b\d{1,2}[.\/-]\d{1,2}[.\/-]\d{4}\b|\b\d{4}[.\/-]\d{2}[.\/-]\d{2}\b/;
const INVOICE_NUMBER_PATTERN = /(?:faktura\s*(?:nr|no|vat)?|invoice\s*(?:no|number|nr)?|rechnung(?:snr)?|nr\s+faktury)[:\s#]*([A-Z0-9\/\-_]+)/i;

export function runInvoiceFilter(text: string | null, filename?: string): FilterResult {
  const reasons: string[] = [];
  let score = 0;

  if (!text || text.trim().length < 30) {
    if (filename) {
      const fn = filename.toLowerCase();
      if (fn.includes('faktura') || fn.includes('invoice') || fn.includes('fv') || fn.includes('rechnung')) {
        return {
          isInvoice: true,
          confidence: 0.4,
          reasons: ['filename suggests invoice, no text (scanned)'],
        };
      }
    }
    return {
      isInvoice: false,
      confidence: 0,
      reasons: ['no extractable text'],
      rejectionReason: 'no_text',
    };
  }

  const lower = text.toLowerCase();

  for (const kw of EXCLUDE_KEYWORDS) {
    if (lower.includes(kw)) {
      return {
        isInvoice: false,
        confidence: 0,
        reasons: [`excluded keyword: "${kw}"`],
        rejectionReason: 'excluded_keyword',
      };
    }
  }

  let hasStrongKeyword = false;
  for (const kw of INVOICE_KEYWORDS_STRONG) {
    if (lower.includes(kw)) {
      hasStrongKeyword = true;
      score += 30;
      reasons.push(`strong keyword: "${kw}"`);
      break;
    }
  }

  let mediumMatches = 0;
  for (const kw of INVOICE_KEYWORDS_MEDIUM) {
    if (lower.includes(kw)) {
      mediumMatches++;
      score += 8;
      reasons.push(`medium keyword: "${kw}"`);
      if (mediumMatches >= 5) break;
    }
  }

  if (NIP_PATTERN.test(text)) {
    score += 15;
    reasons.push('NIP/tax ID pattern found');
  }

  if (DATE_PATTERN.test(text)) {
    score += 5;
    reasons.push('date pattern found');
  }

  for (const p of AMOUNT_PATTERNS) {
    if (p.test(text)) {
      score += 15;
      reasons.push('monetary amount with currency found');
      break;
    }
  }

  if (INVOICE_NUMBER_PATTERN.test(text)) {
    score += 20;
    reasons.push('invoice number pattern found');
  }

  if (filename) {
    const fn = filename.toLowerCase();
    if (fn.includes('faktura') || fn.includes('invoice') || fn.includes('rechnung') || fn.includes('facture')) {
      score += 10;
      reasons.push('filename suggests invoice');
    }
    if (fn.includes('newsletter') || fn.includes('promo') || fn.includes('oferta')) {
      score -= 20;
      reasons.push('filename suggests non-invoice');
    }
  }

  const confidence = Math.min(score / 100, 1.0);
  const PASS_THRESHOLD = 40;

  if (!hasStrongKeyword && score < PASS_THRESHOLD) {
    return {
      isInvoice: false,
      confidence,
      reasons,
      rejectionReason: `low_score:${score}`,
    };
  }

  return {
    isInvoice: true,
    confidence,
    reasons,
  };
}

// ─────────────────────────────────────────────
// STEP 3: AI FIELD MAPPING
// Claude/GPT receives extracted text JSON, maps to invoice fields
// ─────────────────────────────────────────────

const AI_MAPPING_PROMPT = `Jesteś ekspertem w analizie faktur VAT (polskich i zagranicznych).
Poniżej znajduje się tekst wyekstrahowany z faktury PDF. Przeanalizuj go i zwróć TYLKO czysty JSON bez komentarzy, markdown czy dodatkowego tekstu.

Format odpowiedzi (DOKŁADNIE te pola):
{
  "invoice_number": "numer faktury lub null",
  "supplier_name": "nazwa SPRZEDAWCY (wystawcy faktury) lub null",
  "supplier_nip": "NIP/VAT ID/Tax ID SPRZEDAWCY (wystawcy faktury) lub null",
  "buyer_name": "nazwa NABYWCY (odbiorcy faktury) lub null",
  "buyer_nip": "NIP NABYWCY (odbiorcy faktury) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "kwota netto jako string z kropką np. 1234.56 (BEZ SPACJI, BEZ PRZECINKÓW)",
  "tax_amount": "kwota VAT jako string z kropką (BEZ SPACJI, BEZ PRZECINKÓW)",
  "gross_amount": "kwota brutto jako string z kropką (BEZ SPACJI, BEZ PRZECINKÓW)",
  "currency": "kod waluty: PLN, EUR, USD, GBP itp.",
  "supplier_country": "kod kraju dostawcy (US, PL, DE, GB itp.) lub null",
  "date_format_detected": "US (MM/DD/YYYY) lub EU (DD.MM.YYYY lub DD/MM/YYYY) lub ISO (YYYY-MM-DD) lub null"
}

KRYTYCZNA ZASADA - NUMER FAKTURY:
- Szukaj: "Invoice number" / "Numer faktury" / "Faktura nr" / "Rechnung Nr"
- NIE zwracaj numeru klienta, zamówienia ani referencyjnego jako numeru faktury
- Numery faktur: litery + cyfry np. VF01260119, FV/2024/001, INV-2024-001

WAŻNE - FORMATOWANIE KWOT:
- BEZ SPACJI, BEZ symboli walut, KROPKA jako separator dziesiętny
- "7 564,62" → "7564.62", "€ 44.400,00" → "44400.00", "44,400.00" → "44400.00"

SPRZEDAWCA vs NABYWCA:
- SPRZEDAWCA = firma która WYSTAWIA fakturę (Seller / From / Sprzedawca / Dostawca)
- NABYWCA = firma która OTRZYMUJE fakturę (Buyer / Bill to / Nabywca / Kupujący)
- "Bill to:" = ZAWSZE NABYWCA

DATY:
- US faktura (adres USA / waluta USD) → format MM/DD/YYYY → konwertuj do YYYY-MM-DD
- EU faktura → format DD.MM.YYYY lub DD/MM/YYYY → konwertuj do YYYY-MM-DD
- Zawsze zwracaj YYYY-MM-DD

Zwróć TYLKO JSON, bez markdown.`;

const AI_MAPPING_PROMPT_VISUAL = `Jesteś ekspertem w analizie faktur VAT (polskich i zagranicznych).
Przeanalizuj dokument wizualnie i zwróć TYLKO czysty JSON bez komentarzy, markdown czy dodatkowego tekstu.

Format odpowiedzi (DOKŁADNIE te pola):
{
  "invoice_number": "numer faktury lub null",
  "supplier_name": "nazwa SPRZEDAWCY (wystawcy faktury) lub null",
  "supplier_nip": "NIP/VAT ID/Tax ID SPRZEDAWCY (wystawcy faktury) lub null",
  "buyer_name": "nazwa NABYWCY (odbiorcy faktury) lub null",
  "buyer_nip": "NIP NABYWCY (odbiorcy faktury) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "kwota netto jako string z kropką np. 1234.56 (BEZ SPACJI, BEZ PRZECINKÓW)",
  "tax_amount": "kwota VAT jako string z kropką (BEZ SPACJI, BEZ PRZECINKÓW)",
  "gross_amount": "kwota brutto jako string z kropką (BEZ SPACJI, BEZ PRZECINKÓW)",
  "currency": "kod waluty: PLN, EUR, USD, GBP itp.",
  "supplier_country": "kod kraju dostawcy (US, PL, DE, GB itp.) lub null",
  "date_format_detected": "US (MM/DD/YYYY) lub EU (DD.MM.YYYY lub DD/MM/YYYY) lub ISO (YYYY-MM-DD) lub null"
}

KRYTYCZNA ZASADA - NUMER FAKTURY:
- Szukaj wizualnie: "Invoice number" / "Numer faktury" / "Faktura nr"
- NIE zwracaj numeru klienta, zamówienia ani referencyjnego jako numeru faktury

WAŻNE - FORMATOWANIE KWOT:
- BEZ SPACJI, BEZ symboli walut, KROPKA jako separator dziesiętny

SPRZEDAWCA vs NABYWCA:
- SPRZEDAWCA = firma która WYSTAWIA fakturę (lewa/górna część)
- NABYWCA = "Bill to" / Nabywca (prawa/dolna część)

DATY: zawsze YYYY-MM-DD. US faktura → MM/DD/YYYY → konwertuj.

Zwróć TYLKO JSON, bez markdown.`;

const CLAUDE_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
];

async function callClaudeWithText(text: string, apiKey: string): Promise<string> {
  let lastError = '';
  for (const model of CLAUDE_MODELS) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: AI_MAPPING_PROMPT,
        messages: [{ role: 'user', content: `Tekst faktury:\n\n${text}\n\nZwróć TYLKO JSON.` }],
        temperature: 0,
      }),
    });
    if (response.status === 404) { lastError = `${model}: 404`; continue; }
    if (!response.ok) throw new Error(`Claude API: ${response.status} - ${await response.text()}`);
    const data = await response.json();
    console.log(`Claude (text) model ${model} succeeded`);
    return data.content[0].text;
  }
  throw new Error(`All Claude models failed. Last: ${lastError}`);
}

async function callClaudeVisual(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const isPDF = mimeType === 'application/pdf';
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };
  if (isPDF) headers['anthropic-beta'] = 'pdfs-2024-09-25';

  const mediaBlock = isPDF
    ? { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: base64Data } }
    : { type: 'image', source: { type: 'base64', media_type: mimeType === 'image/png' ? 'image/png' : 'image/jpeg', data: base64Data } };

  let lastError = '';
  for (const model of CLAUDE_MODELS) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 1000,
        system: AI_MAPPING_PROMPT_VISUAL,
        messages: [{ role: 'user', content: [mediaBlock, { type: 'text', text: 'Przeanalizuj i zwróć TYLKO JSON.' }] }],
        temperature: 0,
      }),
    });
    if (response.status === 404) { lastError = `${model}: 404`; continue; }
    if (!response.ok) throw new Error(`Claude API: ${response.status} - ${await response.text()}`);
    const data = await response.json();
    console.log(`Claude (visual) model ${model} succeeded`);
    return data.content[0].text;
  }
  throw new Error(`All Claude models failed. Last: ${lastError}`);
}

async function callGPT4oWithText(text: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o-mini',
      messages: [
        { role: 'system', content: AI_MAPPING_PROMPT },
        { role: 'user', content: `Tekst faktury:\n\n${text}\n\nZwróć TYLKO JSON.` },
      ],
      max_tokens: 1000,
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`GPT-4o-mini: ${response.status} - ${await response.text()}`);
  return (await response.json()).choices[0].message.content;
}

async function callGPT4oVisual(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const isPDF = mimeType === 'application/pdf';
  const mediaBlock = isPDF
    ? { type: 'file', file: { filename: 'invoice.pdf', file_data: `data:application/pdf;base64,${base64Data}` } }
    : { type: 'image_url', image_url: { url: `data:${mimeType === 'image/png' ? 'image/png' : 'image/jpeg'};base64,${base64Data}`, detail: 'high' } };

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: [{ type: 'text', text: `${AI_MAPPING_PROMPT_VISUAL}\n\nZwróć TYLKO JSON.` }, mediaBlock] }],
      max_tokens: 1000,
      temperature: 0,
    }),
  });
  if (!response.ok) throw new Error(`GPT-4o: ${response.status} - ${await response.text()}`);
  return (await response.json()).choices[0].message.content;
}

async function callMistralVisual(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const imageMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const response = await fetch('https://api.mistral.ai/v1/chat/completions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: 'pixtral-12b-2409',
      messages: [{ role: 'user', content: [
        { type: 'text', text: `${AI_MAPPING_PROMPT_VISUAL}\n\nZwróć TYLKO JSON.` },
        { type: 'image_url', image_url: `data:${imageMime};base64,${base64Data}` },
      ]}],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });
  if (!response.ok) throw new Error(`Mistral: ${response.status} - ${await response.text()}`);
  return (await response.json()).choices[0].message.content;
}

async function runAIMapping(
  raw: ExtractedRawData,
  claudeKey?: string,
  openaiKey?: string,
  mistralKey?: string,
): Promise<{ content: string; usedApi: string }> {
  const hasText = raw.text && raw.text.length >= 30;

  if (hasText) {
    if (claudeKey) {
      try {
        const content = await callClaudeWithText(raw.text!, claudeKey);
        return { content, usedApi: 'Claude (text)' };
      } catch (e: any) { console.error('Claude text failed:', e.message); }
    }
    if (openaiKey) {
      try {
        const content = await callGPT4oWithText(raw.text!, openaiKey);
        return { content, usedApi: 'GPT-4o-mini (text)' };
      } catch (e: any) { console.error('GPT text failed:', e.message); }
    }
  }

  if (claudeKey) {
    try {
      const content = await callClaudeVisual(raw.base64, raw.mimeType, claudeKey);
      return { content, usedApi: `Claude (visual${raw.isScanned ? ' scanned' : ''})` };
    } catch (e: any) { console.error('Claude visual failed:', e.message); }
  }
  if (openaiKey) {
    try {
      const content = await callGPT4oVisual(raw.base64, raw.mimeType, openaiKey);
      return { content, usedApi: `GPT-4o (visual${raw.isScanned ? ' scanned' : ''})` };
    } catch (e: any) { console.error('GPT visual failed:', e.message); }
  }
  if (mistralKey && raw.mimeType !== 'application/pdf') {
    try {
      const content = await callMistralVisual(raw.base64, raw.mimeType, mistralKey);
      return { content, usedApi: 'Mistral (visual)' };
    } catch (e: any) { console.error('Mistral visual failed:', e.message); }
  }

  return { content: JSON.stringify(createFallback()), usedApi: 'Fallback (no API)' };
}

// ─────────────────────────────────────────────
// UTILITIES
// ─────────────────────────────────────────────

function createFallback() {
  return {
    invoice_number: null, supplier_name: null, supplier_nip: null,
    buyer_name: null, buyer_nip: null, issue_date: null, due_date: null,
    net_amount: null, tax_amount: null, gross_amount: null, currency: 'PLN',
  };
}

async function blobToBase64(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192) {
    const chunk = bytes.subarray(i, i + 8192);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

async function fetchFile(url: string, fallbackMime: string): Promise<{ base64: string; mimeType: string }> {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`Fetch failed: ${resp.status} ${url}`);
  const blob = await resp.blob();
  let mimeType = fallbackMime;
  const ct = resp.headers.get('content-type') || '';
  if (ct && ct !== 'application/octet-stream') mimeType = ct.split(';')[0].trim();
  else if (/\.pdf(\?|$)/i.test(url)) mimeType = 'application/pdf';
  else if (/\.(jpg|jpeg)(\?|$)/i.test(url)) mimeType = 'image/jpeg';
  else if (/\.png(\?|$)/i.test(url)) mimeType = 'image/png';
  return { base64: await blobToBase64(blob), mimeType };
}

function normalizeDate(dateStr: unknown, supplierCountry?: string, dateFormatDetected?: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [, m, d] = s.split('-').map(Number);
    return (m >= 1 && m <= 12 && d >= 1 && d <= 31) ? s : null;
  }

  const isUS = supplierCountry === 'US' || dateFormatDetected === 'US (MM/DD/YYYY)';

  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch.map(Number);
    const [month, day] = isUS ? [a, b] : (a > 12 ? [b, a] : [b > 12 ? a : b, b > 12 ? b : a]);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const dotMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch.map(Number);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const dashMatch = s.match(/^(\d{1,2})-(\d{1,2})-(\d{4})$/);
  if (dashMatch) {
    const [, a, b, yearStr] = dashMatch;
    const year = Number(yearStr), aNum = Number(a), bNum = Number(b);
    const [day, month] = isUS ? [bNum, aNum] : [aNum, bNum];
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31)
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  }

  const MONTHS: Record<string, string> = {
    january:'01', february:'02', march:'03', april:'04', may:'05', june:'06',
    july:'07', august:'08', september:'09', october:'10', november:'11', december:'12',
    jan:'01', feb:'02', mar:'03', apr:'04', jun:'06', jul:'07',
    aug:'08', sep:'09', oct:'10', nov:'11', dec:'12',
  };
  const wm1 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (wm1) {
    const m = MONTHS[wm1[1].toLowerCase()];
    if (m) return `${wm1[3]}-${m}-${String(Number(wm1[2])).padStart(2, '0')}`;
  }
  const wm2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (wm2) {
    const m = MONTHS[wm2[2].toLowerCase()];
    if (m) return `${wm2[3]}-${m}-${String(Number(wm2[1])).padStart(2, '0')}`;
  }

  return null;
}

function parseAmount(val: unknown): number | null {
  if (val === null || val === undefined || val === '') return null;
  let s = String(val).replace(/\s/g, '').replace(/[€$£]/g, '');
  const dots = (s.match(/\./g) || []).length;
  const commas = (s.match(/,/g) || []).length;
  if (dots >= 1 && commas === 1) {
    s = s.lastIndexOf('.') < s.lastIndexOf(',') ? s.replace(/\./g, '').replace(',', '.') : s.replace(/,/g, '');
  } else if (commas >= 1 && dots === 0) {
    const parts = s.split(',');
    s = parts.length === 2 && parts[1].length <= 2 ? s.replace(',', '.') : s.replace(/,/g, '');
  } else if (dots >= 2) {
    s = s.replace(/\./g, '');
  } else if (dots === 1 && commas === 0 && (s.split('.')[1] || '').length === 3) {
    s = s.replace('.', '');
  }
  const n = parseFloat(s);
  return isNaN(n) ? null : n;
}

// ─────────────────────────────────────────────
// MAIN HANDLER
// ─────────────────────────────────────────────

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response(null, { status: 200, headers: corsHeaders });

  try {
    console.log('=== OCR PIPELINE START ===');

    const claudeKey = Deno.env.get('ANTHROPIC_API_KEY');
    const openaiKey = Deno.env.get('OPENAI_API_KEY');
    const mistralKey = Deno.env.get('MISTRAL_API_KEY');
    const supabaseUrl = Deno.env.get('SUPABASE_URL')!;
    const supabaseServiceKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const body: OCRRequest = await req.json();
    const { fileUrl, invoiceId, pdfBase64, fileBase64, mimeType: reqMime, skipFilter } = body;

    console.log('Request:', { invoiceId, hasBase64: !!(fileBase64 || pdfBase64), hasUrl: !!fileUrl });

    if (!claudeKey && !openaiKey && !mistralKey) {
      console.warn('No AI keys — skipping OCR');
      return new Response(
        JSON.stringify({ success: true, data: createFallback(), usedApi: 'None', suggestedTags: [] }),
        { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
      );
    }

    let resolvedMime = reqMime || 'application/pdf';
    let base64Data: string;

    if (fileBase64 || pdfBase64) {
      base64Data = fileBase64 || pdfBase64!;
    } else {
      let url = fileUrl || null;
      if (!url && invoiceId) {
        const { data: row } = await supabase.from('invoices').select('file_url').eq('id', invoiceId).maybeSingle();
        url = row?.file_url || null;
      }
      if (!url) throw new Error(`No file URL for invoice ${invoiceId}`);
      const fetched = await fetchFile(url, resolvedMime);
      base64Data = fetched.base64;
      resolvedMime = fetched.mimeType;
    }

    // ── STEP 1: EXTRACT ──
    console.log('STEP 1: Extracting text...');
    const raw = await extractRawData(base64Data, resolvedMime);
    console.log(`Extracted: text=${raw.text ? raw.text.length + ' chars' : 'none'}, scanned=${raw.isScanned}`);

    // ── STEP 2: FILTER (skip for images — always go to AI) ──
    let filterResult: FilterResult | null = null;
    if (!skipFilter && resolvedMime === 'application/pdf') {
      console.log('STEP 2: Running invoice filter algorithm...');

      const { data: invoiceRow } = await supabase
        .from('invoices').select('file_url').eq('id', invoiceId).maybeSingle();
      const filename = invoiceRow?.file_url
        ? invoiceRow.file_url.split('/').pop()?.split('?')[0] || undefined
        : undefined;

      filterResult = runInvoiceFilter(raw.text, filename);
      console.log('Filter result:', filterResult);

      if (!filterResult.isInvoice && !raw.isScanned) {
        return new Response(
          JSON.stringify({
            success: false,
            filtered: true,
            filterResult,
            message: `Document rejected by filter algorithm: ${filterResult.rejectionReason}`,
          }),
          { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
        );
      }

      if (raw.isScanned) {
        console.log('Scanned PDF — skipping text filter, proceeding to AI visual analysis');
      }
    } else if (skipFilter) {
      console.log('STEP 2: Filter skipped (skipFilter=true)');
    } else {
      console.log('STEP 2: Filter skipped (image file)');
    }

    // ── STEP 3: AI FIELD MAPPING ──
    console.log('STEP 3: AI field mapping...');
    const { content, usedApi } = await runAIMapping(raw, claudeKey, openaiKey, mistralKey);
    console.log(`Used: ${usedApi}`);
    console.log(`Raw response (first 300): ${content.substring(0, 300)}`);

    let parsedData: Record<string, unknown>;
    try {
      parsedData = JSON.parse(content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim());
    } catch {
      console.error('JSON parse failed:', content);
      parsedData = createFallback();
    }

    console.log('Mapped data:', JSON.stringify(parsedData));

    // ── STEP 4: PERSIST TO DATABASE ──
    const { data: existingInvoice } = await supabase
      .from('invoices').select('*').eq('id', invoiceId).maybeSingle();

    const COMPANY_NIPS = ['5851490834', '8222407812'];
    const CORRECT_BUYER_NIP = '5851490834';
    let supplierErrorMessage: string | null = null;
    let buyerErrorMessage: string | null = null;

    if (parsedData.supplier_nip) {
      const clean = String(parsedData.supplier_nip).replace(/[^0-9]/g, '');
      if (COMPANY_NIPS.some(n => clean === n)) {
        const name = clean === '5851490834' ? 'Aura Herbals' : 'firma';
        supplierErrorMessage = `BŁĄD: AI pomyliło strony faktury - ${name} (NIP: ${clean}) to NABYWCA, nie SPRZEDAWCA.`;
        parsedData.supplier_name = `[BŁĄD: TO NABYWCA] ${parsedData.supplier_name || ''}`;
        parsedData.supplier_nip = `[BŁĄD] ${parsedData.supplier_nip}`;
      }
    }
    if (parsedData.buyer_nip) {
      const clean = String(parsedData.buyer_nip).replace(/[^0-9]/g, '');
      if (clean !== CORRECT_BUYER_NIP) buyerErrorMessage = `BŁĘDNY ODBIORCA: NIP ${parsedData.buyer_nip}`;
    } else if (parsedData.buyer_name) {
      const bn = String(parsedData.buyer_name).toLowerCase();
      if (!bn.includes('aura') || !bn.includes('herbals'))
        buyerErrorMessage = `BŁĘDNY ODBIORCA: ${parsedData.buyer_name}`;
    }

    const supplierCountry = typeof parsedData.supplier_country === 'string'
      ? parsedData.supplier_country.toUpperCase() : undefined;
    const dateFormatDetected = typeof parsedData.date_format_detected === 'string'
      ? parsedData.date_format_detected : undefined;

    const updateData: Record<string, unknown> = {};
    if (parsedData.invoice_number) updateData.invoice_number = parsedData.invoice_number;
    if (parsedData.supplier_name) updateData.supplier_name = parsedData.supplier_name;
    if (parsedData.supplier_nip) updateData.supplier_nip = parsedData.supplier_nip;
    if (parsedData.buyer_name) updateData.buyer_name = parsedData.buyer_name;
    if (parsedData.buyer_nip) updateData.buyer_nip = parsedData.buyer_nip;
    if (parsedData.currency) updateData.currency = parsedData.currency;

    const nd = normalizeDate(parsedData.issue_date, supplierCountry, dateFormatDetected);
    const nd2 = normalizeDate(parsedData.due_date, supplierCountry, dateFormatDetected);
    if (nd) updateData.issue_date = nd;
    if (nd2) updateData.due_date = nd2;

    const net = parseAmount(parsedData.net_amount);
    const tax = parseAmount(parsedData.tax_amount);
    const gross = parseAmount(parsedData.gross_amount);
    if (net !== null) updateData.net_amount = net;
    if (tax !== null) updateData.tax_amount = tax;
    if (gross !== null) updateData.gross_amount = gross;

    const currency = String(updateData.currency || existingInvoice?.currency || 'PLN');
    const issueDate = String(updateData.issue_date || existingInvoice?.issue_date || new Date().toISOString().split('T')[0]);

    if (currency !== 'PLN') {
      try {
        const rateRes = await fetch(`${supabaseUrl}/functions/v1/get-exchange-rate`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${supabaseServiceKey}` },
          body: JSON.stringify({ currency, date: issueDate }),
        });
        if (rateRes.ok) {
          const rd = await rateRes.json();
          updateData.exchange_rate = rd.rate;
          updateData.exchange_rate_date = rd.effectiveDate;
        } else {
          updateData.exchange_rate = 1.0;
          updateData.exchange_rate_date = issueDate;
        }
      } catch {
        updateData.exchange_rate = 1.0;
        updateData.exchange_rate_date = issueDate;
      }
    } else {
      updateData.exchange_rate = 1.0;
      updateData.exchange_rate_date = issueDate;
    }

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from('invoices').update(updateData).eq('id', invoiceId);
      if (updateError) throw updateError;
      console.log('Invoice updated in DB');
    }

    let suggestedTags: unknown[] = [];
    try {
      const vendorName = String(updateData.supplier_name || '').trim();
      if (vendorName) {
        const { data: vt } = await supabase
          .from('tag_learning').select('tag_id, frequency, tags:tag_id(id, name, color)')
          .ilike('vendor_name', vendorName);
        if (vt?.length) {
          suggestedTags = vt
            .filter((i: Record<string, unknown>) => i.tags)
            .sort((a: Record<string, number>, b: Record<string, number>) => b.frequency - a.frequency)
            .slice(0, 3)
            .map((i: Record<string, unknown>) => {
              const t = i.tags as Record<string, unknown>;
              return { id: t.id, name: t.name, color: t.color, confidence: (i.frequency as number) * 2 };
            });
        }
      }
    } catch (e) { console.error('Tags error:', e); }

    let suggestedDescription: string | null = null;
    try {
      const vendorName = String(updateData.supplier_name || '').trim();
      const supplierNip = String(updateData.supplier_nip || '').trim();
      if (vendorName || supplierNip) {
        let q = supabase.from('invoices').select('description')
          .not('description', 'is', null).neq('description', '')
          .order('created_at', { ascending: false }).limit(50);
        if (supplierNip) q = q.eq('supplier_nip', supplierNip);
        else q = q.ilike('supplier_name', vendorName);
        const { data: hist } = await q;
        if (hist?.length) {
          const counts: Record<string, number> = {};
          for (const inv of hist) { const d = String(inv.description).trim(); counts[d] = (counts[d] || 0) + 1; }
          suggestedDescription = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      if (suggestedDescription) {
        const { data: cur } = await supabase.from('invoices').select('description').eq('id', invoiceId).maybeSingle();
        if (cur && (!cur.description || cur.description.trim() === ''))
          await supabase.from('invoices').update({ description: suggestedDescription }).eq('id', invoiceId);
      }
    } catch (e) { console.error('Description error:', e); }

    console.log('=== OCR PIPELINE DONE ===');

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
        usedApi,
        filterResult,
        suggestedTags,
        suggestedDescription,
        validationError: supplierErrorMessage,
        buyerError: buyerErrorMessage,
      }),
      { headers: { ...corsHeaders, 'Content-Type': 'application/json' } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('=== OCR PIPELINE FAILED ===', msg);
    return new Response(JSON.stringify({ error: msg }), { status: 500, headers: { ...corsHeaders, 'Content-Type': 'application/json' } });
  }
});
