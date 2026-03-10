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
}

const INVOICE_SYSTEM_PROMPT = `Jesteś ekspertem w analizie faktur VAT (polskich i zagranicznych).
Przeanalizuj dokument i zwróć TYLKO czysty JSON bez komentarzy, markdown czy dodatkowego tekstu.

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

BARDZO WAŻNE - FORMATOWANIE KWOT:
- ZAWSZE zwracaj kwoty BEZ SPACJI (np. zamiast "7 564,62" zwróć "7564.62")
- ZAWSZE używaj KROPKI jako separatora dziesiętnego (nie przecinka)
- USUŃ wszystkie spacje z kwot
- USUŃ symbole walut (€, $, £) z kwot
- Przykłady konwersji:
  - "7 564,62" → "7564.62"
  - "1 234 567,89" → "1234567.89"
  - "123,45" → "123.45"
  - "€ 44.400,00" → "44400.00" (UWAGA: tu kropka to separator tysięcy, przecinek to dziesiętny!)
  - "€ 138.800,00" → "138800.00"
  - "44,400.00" → "44400.00" (format angielski: przecinek = tysiące, kropka = dziesiętne)
  - "1.234.567,89" → "1234567.89" (wiele kropek = separatory tysięcy)

KRYTYCZNA ZASADA - IDENTYFIKACJA SPRZEDAWCY vs NABYWCY:
1. SPRZEDAWCA (Seller, Vendor, Supplier, Dostawca, Wystawca, Sprzedawca) - firma która WYSTAWIA fakturę → supplier_name, supplier_nip
2. NABYWCA (Buyer, Customer, Bill to, Nabywca, Kupujący, Odbiorca) - firma która OTRZYMUJE fakturę → buyer_name, buyer_nip

- Faktury polskie: LEWA strona/GÓRA = Sprzedawca, PRAWA/DÓŁ = Nabywca
- "Bill to:" ZAWSZE = NABYWCA, nigdy Sprzedawca
- Szukaj etykiet: "Sprzedawca:", "Nabywca:", "Seller:", "Buyer:", "From:", "Bill to:"

KRYTYCZNA ZASADA - FORMATOWANIE DAT:
Faktury od kontrahentów AMERYKAŃSKICH (USA) używają formatu MM/DD/YYYY, który RÓŻNI się od europejskiego DD/MM/YYYY.
Musisz poprawnie rozpoznać format daty na podstawie kraju wystawcy faktury i kontekstu dokumentu.

ROZPOZNAWANIE FORMATU DAT:
- Faktura z USA/US address/$ currency → format MM/DD/YYYY → np. "01/15/2024" to 15 stycznia 2024 → YYYY-MM-DD: "2024-01-15"
- Faktura europejska (PL, DE, FR, GB itp.) → format DD.MM.YYYY lub DD/MM/YYYY → np. "15.01.2024" to 15 stycznia 2024
- Jeśli widzisz miesiąc słownie (January, Feb, March, Jan itp.) → zawsze konwertuj do YYYY-MM-DD
- Zawsze zwracaj daty w formacie YYYY-MM-DD

PRZYKŁADY KONWERSJI DAT:
- US: "01/15/2024" → "2024-01-15" (styczeń 15)
- US: "12/31/2023" → "2023-12-31" (grudzień 31)
- EU: "15.01.2024" → "2024-01-15" (15 styczeń)
- EU: "31/12/2023" → "2023-12-31" (31 grudzień)
- Słownie: "January 15, 2024" → "2024-01-15"
- Słownie: "15 January 2024" → "2024-01-15"

WSKAZÓWKI DO WYKRYWANIA KRAJU DOSTAWCY:
- Adres z stanami USA (CA, NY, TX, FL, WA itp.) → kraj US
- Adres z "United States" lub "USA" → kraj US
- Waluta USD na fakturze od dostawcy → sugeruje US
- NIP/VAT format: EIN xx-xxxxxxx (USA), NIP xxxxxxxxxx (PL)

DODATKOWE UWAGI:
- Akceptuj faktury w dowolnej walucie (PLN, EUR, USD, GBP itp.)
- Walutę zapisz jako 3-literowy kod ISO
- Zwróć TYLKO JSON, bez \`\`\`json ani innych oznaczeń`;

async function blobToBase64(blob: Blob): Promise<string> {
  const ab = await blob.arrayBuffer();
  const bytes = new Uint8Array(ab);
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

const CLAUDE_MODELS = [
  'claude-opus-4-5',
  'claude-sonnet-4-5',
  'claude-3-5-sonnet-20241022',
  'claude-3-opus-20240229',
];

async function callClaudeWithDocument(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const isPDF = mimeType === 'application/pdf';

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (isPDF) {
    headers['anthropic-beta'] = 'pdfs-2024-09-25';
  }

  let mediaBlock: Record<string, unknown>;
  if (isPDF) {
    mediaBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      },
    };
  } else {
    const imageMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    mediaBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMime,
        data: base64Data,
      },
    };
  }

  let lastError = '';
  for (const model of CLAUDE_MODELS) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model,
        max_tokens: 2000,
        system: INVOICE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              mediaBlock,
              {
                type: 'text',
                text: 'Przeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON.',
              },
            ],
          },
        ],
        temperature: 0,
      }),
    });

    if (response.status === 404) {
      const err = await response.text();
      console.warn(`Claude model ${model} not found, trying next...`);
      lastError = `${model}: 404`;
      continue;
    }

    if (!response.ok) {
      const err = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${err}`);
    }

    const data = await response.json();
    console.log(`✓ Claude model ${model} succeeded`);
    return data.content[0].text;
  }

  throw new Error(`All Claude models failed. Last error: ${lastError}`);
}

async function callGPT4oWithDocument(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const isPDF = mimeType === 'application/pdf';

  let mediaBlock: Record<string, unknown>;
  if (isPDF) {
    mediaBlock = {
      type: 'file',
      file: {
        filename: 'invoice.pdf',
        file_data: `data:application/pdf;base64,${base64Data}`,
      },
    };
  } else {
    const imageMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    mediaBlock = {
      type: 'image_url',
      image_url: { url: `data:${imageMime};base64,${base64Data}`, detail: 'high' },
    };
  }

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages: [
        {
          role: 'user',
          content: [
            {
              type: 'text',
              text: `${INVOICE_SYSTEM_PROMPT}\n\nPrzeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON.`,
            },
            mediaBlock,
          ],
        },
      ],
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`GPT-4o API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function callMistralWithDocument(base64Data: string, mimeType: string, apiKey: string): Promise<string> {
  const imageMime = mimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${imageMime};base64,${base64Data}`;

  const response = await fetch("https://api.mistral.ai/v1/chat/completions", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: "pixtral-12b-2409",
      messages: [
        {
          role: "user",
          content: [
            {
              type: "text",
              text: `${INVOICE_SYSTEM_PROMPT}\n\nPrzeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON.`,
            },
            {
              type: "image_url",
              image_url: dataUrl,
            },
          ],
        },
      ],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${err}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function normalizeDate(dateStr: unknown, supplierCountry?: string, dateFormatDetected?: string): string | null {
  if (!dateStr || typeof dateStr !== 'string') return null;
  const s = dateStr.trim();
  if (!s) return null;

  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) {
    const [y, m, d] = s.split('-').map(Number);
    if (m >= 1 && m <= 12 && d >= 1 && d <= 31) return s;
    return null;
  }

  const isUS = supplierCountry === 'US' || dateFormatDetected === 'US (MM/DD/YYYY)';

  const slashMatch = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (slashMatch) {
    const [, a, b, y] = slashMatch.map(Number);
    if (isUS) {
      const month = a, day = b;
      if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
        return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      }
    } else {
      if (a > 12) {
        const day = a, month = b;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      } else if (b > 12) {
        const month = a, day = b;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      } else {
        const day = a, month = b;
        if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
          return `${y}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        }
      }
    }
  }

  const dotMatch = s.match(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/);
  if (dotMatch) {
    const [, day, month, year] = dotMatch.map(Number);
    if (month >= 1 && month <= 12 && day >= 1 && day <= 31) {
      return `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    }
  }

  const MONTHS: Record<string, string> = {
    january: '01', february: '02', march: '03', april: '04',
    may: '05', june: '06', july: '07', august: '08',
    september: '09', october: '10', november: '11', december: '12',
    jan: '01', feb: '02', mar: '03', apr: '04',
    jun: '06', jul: '07', aug: '08', sep: '09', oct: '10', nov: '11', dec: '12',
  };

  const wordMatch1 = s.match(/^([A-Za-z]+)\s+(\d{1,2}),?\s+(\d{4})$/);
  if (wordMatch1) {
    const [, monthWord, day, year] = wordMatch1;
    const month = MONTHS[monthWord.toLowerCase()];
    if (month) return `${year}-${month}-${String(Number(day)).padStart(2, '0')}`;
  }

  const wordMatch2 = s.match(/^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/);
  if (wordMatch2) {
    const [, day, monthWord, year] = wordMatch2;
    const month = MONTHS[monthWord.toLowerCase()];
    if (month) return `${year}-${month}-${String(Number(day)).padStart(2, '0')}`;
  }

  console.warn(`normalizeDate: could not parse date "${s}" (country=${supplierCountry}, format=${dateFormatDetected})`);
  return null;
}

function createFallback() {
  return {
    invoice_number: null,
    supplier_name: null,
    supplier_nip: null,
    buyer_name: null,
    buyer_nip: null,
    issue_date: null,
    due_date: null,
    net_amount: null,
    tax_amount: null,
    gross_amount: null,
    currency: "PLN",
  };
}

async function fetchFileFromUrl(url: string, fallbackMimeType: string): Promise<{ base64: string; mimeType: string }> {
  console.log("Fetching file from URL:", url);
  const resp = await fetch(url);
  if (!resp.ok) {
    throw new Error(`Failed to fetch file: ${resp.status} ${resp.statusText} — ${url}`);
  }
  const blob = await resp.blob();

  let mimeType = fallbackMimeType;
  const ct = resp.headers.get('content-type') || '';
  if (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') {
    mimeType = ct.split(';')[0].trim();
  } else if (url.match(/\.(jpg|jpeg)(\?|$)/i)) {
    mimeType = 'image/jpeg';
  } else if (url.match(/\.png(\?|$)/i)) {
    mimeType = 'image/png';
  } else if (url.match(/\.pdf(\?|$)/i)) {
    mimeType = 'application/pdf';
  }

  console.log(`File fetched: ${blob.size} bytes, mimeType=${mimeType}`);
  const base64 = await blobToBase64(blob);
  return { base64, mimeType };
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("=== OCR STARTED ===");

    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log("API Keys available:", { claude: !!claudeApiKey, openai: !!openaiApiKey, mistral: !!mistralApiKey });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: OCRRequest = await req.json();
    const { fileUrl, invoiceId, pdfBase64, fileBase64, mimeType: requestMimeType } = body;

    console.log("Request:", { invoiceId, hasBase64: !!(fileBase64 || pdfBase64), hasUrl: !!fileUrl, mimeType: requestMimeType });

    if (!claudeApiKey && !openaiApiKey && !mistralApiKey) {
      console.warn("No AI API keys configured — skipping OCR");
      return new Response(
        JSON.stringify({ success: true, data: createFallback(), usedApi: "None (no API keys)", suggestedTags: [] }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let resolvedMimeType = requestMimeType || 'application/pdf';
    let base64Data: string;

    if (fileBase64 || pdfBase64) {
      base64Data = fileBase64 || pdfBase64!;
      console.log(`Using provided base64, mimeType: ${resolvedMimeType}, length: ${base64Data.length}`);
    } else {
      let urlToFetch = fileUrl || null;

      if (!urlToFetch && invoiceId) {
        console.log("Looking up file_url from DB for invoice:", invoiceId);
        const { data: invoiceRow, error: dbErr } = await supabase
          .from("invoices")
          .select("file_url")
          .eq("id", invoiceId)
          .maybeSingle();
        if (dbErr) console.error("DB lookup error:", dbErr.message);
        urlToFetch = invoiceRow?.file_url || null;
        console.log("file_url from DB:", urlToFetch);
      }

      if (!urlToFetch) {
        throw new Error(`No file URL available for invoice ${invoiceId}`);
      }

      const fetched = await fetchFileFromUrl(urlToFetch, resolvedMimeType);
      base64Data = fetched.base64;
      resolvedMimeType = fetched.mimeType;
    }

    const isPDF = resolvedMimeType === 'application/pdf';
    console.log(`Processing as: ${isPDF ? 'PDF document' : 'image'}, mimeType: ${resolvedMimeType}, base64 length: ${base64Data.length}`);

    let content: string;
    let usedApi: string;

    if (claudeApiKey) {
      try {
        console.log("Calling Claude API...");
        content = await callClaudeWithDocument(base64Data, resolvedMimeType, claudeApiKey);
        usedApi = isPDF ? "Claude (PDF)" : "Claude (Image)";
        console.log("✓ Claude success");
      } catch (err: any) {
        console.error("Claude failed:", err.message);
        if (openaiApiKey) {
          try {
            console.log("Fallback to GPT-4o...");
            content = await callGPT4oWithDocument(base64Data, resolvedMimeType, openaiApiKey);
            usedApi = isPDF ? "GPT-4o (PDF fallback)" : "GPT-4o Vision (fallback)";
            console.log("✓ GPT-4o success");
          } catch (gErr: any) {
            console.error("GPT-4o also failed:", gErr.message);
            if (!isPDF && mistralApiKey) {
              try {
                content = await callMistralWithDocument(base64Data, resolvedMimeType, mistralApiKey);
                usedApi = "Mistral Pixtral (fallback)";
              } catch {
                content = JSON.stringify(createFallback());
                usedApi = "Fallback (all APIs failed)";
              }
            } else {
              content = JSON.stringify(createFallback());
              usedApi = `Fallback (Claude+GPT-4o failed: ${gErr.message})`;
            }
          }
        } else if (!isPDF && mistralApiKey) {
          try {
            content = await callMistralWithDocument(base64Data, resolvedMimeType, mistralApiKey);
            usedApi = "Mistral Pixtral (fallback from Claude)";
          } catch {
            content = JSON.stringify(createFallback());
            usedApi = "Fallback (Claude + Mistral failed)";
          }
        } else {
          content = JSON.stringify(createFallback());
          usedApi = `Fallback (Claude failed: ${err.message})`;
        }
      }
    } else if (openaiApiKey) {
      try {
        console.log("Calling GPT-4o...");
        content = await callGPT4oWithDocument(base64Data, resolvedMimeType, openaiApiKey);
        usedApi = isPDF ? "GPT-4o (PDF)" : "GPT-4o Vision";
        console.log("✓ GPT-4o success");
      } catch (err: any) {
        console.error("GPT-4o failed:", err.message);
        if (!isPDF && mistralApiKey) {
          try {
            content = await callMistralWithDocument(base64Data, resolvedMimeType, mistralApiKey);
            usedApi = "Mistral Pixtral (fallback from GPT-4o)";
          } catch {
            content = JSON.stringify(createFallback());
            usedApi = "Fallback (GPT-4o + Mistral failed)";
          }
        } else {
          content = JSON.stringify(createFallback());
          usedApi = `Fallback (GPT-4o failed: ${err.message})`;
        }
      }
    } else if (!isPDF && mistralApiKey) {
      try {
        content = await callMistralWithDocument(base64Data, resolvedMimeType, mistralApiKey);
        usedApi = "Mistral Pixtral";
      } catch (err: any) {
        content = JSON.stringify(createFallback());
        usedApi = `Fallback (Mistral failed: ${err.message})`;
      }
    } else {
      content = JSON.stringify(createFallback());
      usedApi = "Fallback (no usable API key for this file type)";
    }

    console.log(`Used API: ${usedApi}`);
    console.log(`Raw response (first 300 chars): ${content.substring(0, 300)}`);

    let parsedData: Record<string, unknown>;
    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedData = JSON.parse(clean);
    } catch (e) {
      console.error("JSON parse failed:", content);
      parsedData = createFallback();
      usedApi = `${usedApi} (parse error)`;
    }

    console.log("Parsed OCR data:", JSON.stringify(parsedData));

    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    const COMPANY_NIPS = ['5851490834', '8222407812'];
    const CORRECT_BUYER_NIP = '5851490834';

    let supplierErrorMessage: string | null = null;
    let buyerErrorMessage: string | null = null;

    if (parsedData.supplier_nip) {
      const clean = String(parsedData.supplier_nip).replace(/[^0-9]/g, '');
      if (COMPANY_NIPS.some(n => clean === n)) {
        const cname = clean === '5851490834' ? 'Aura Herbals' : 'firma';
        supplierErrorMessage = `BŁĄD: AI pomyliło strony faktury - ${cname} (NIP: ${clean}) to NABYWCA, nie SPRZEDAWCA.`;
        console.error(supplierErrorMessage);
        parsedData.supplier_name = `[BŁĄD: TO NABYWCA] ${parsedData.supplier_name || ''}`;
        parsedData.supplier_nip = `[BŁĄD] ${parsedData.supplier_nip}`;
      }
    }

    if (parsedData.buyer_nip) {
      const clean = String(parsedData.buyer_nip).replace(/[^0-9]/g, '');
      if (clean !== CORRECT_BUYER_NIP) {
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (NIP: ${parsedData.buyer_nip}).`;
        console.warn(buyerErrorMessage);
      }
    } else if (parsedData.buyer_name) {
      const bn = String(parsedData.buyer_name).toLowerCase();
      if (!bn.includes('aura') || !bn.includes('herbals')) {
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (${parsedData.buyer_name}).`;
        console.warn(buyerErrorMessage);
      }
    }

    const updateData: Record<string, unknown> = {};

    const supplierCountry = typeof parsedData.supplier_country === 'string' ? parsedData.supplier_country.toUpperCase() : undefined;
    const dateFormatDetected = typeof parsedData.date_format_detected === 'string' ? parsedData.date_format_detected : undefined;

    console.log(`Supplier country: ${supplierCountry}, date format: ${dateFormatDetected}`);

    const normalizedIssueDate = normalizeDate(parsedData.issue_date, supplierCountry, dateFormatDetected);
    const normalizedDueDate = normalizeDate(parsedData.due_date, supplierCountry, dateFormatDetected);

    if (normalizedIssueDate && normalizedIssueDate !== parsedData.issue_date) {
      console.log(`Date normalized (issue_date): "${parsedData.issue_date}" → "${normalizedIssueDate}" [country=${supplierCountry}]`);
    }
    if (normalizedDueDate && normalizedDueDate !== parsedData.due_date) {
      console.log(`Date normalized (due_date): "${parsedData.due_date}" → "${normalizedDueDate}" [country=${supplierCountry}]`);
    }

    if (parsedData.invoice_number) updateData.invoice_number = parsedData.invoice_number;
    if (parsedData.supplier_name) updateData.supplier_name = parsedData.supplier_name;
    if (parsedData.supplier_nip) updateData.supplier_nip = parsedData.supplier_nip;
    if (parsedData.buyer_name) updateData.buyer_name = parsedData.buyer_name;
    if (parsedData.buyer_nip) updateData.buyer_nip = parsedData.buyer_nip;
    if (normalizedIssueDate) updateData.issue_date = normalizedIssueDate;
    if (normalizedDueDate) updateData.due_date = normalizedDueDate;
    if (parsedData.currency) updateData.currency = parsedData.currency;

    const parseAmount = (val: unknown): number | null => {
      if (val === null || val === undefined || val === '') return null;
      let s = String(val).replace(/\s/g, '').replace(/[€$£]/g, '');

      const dotCount = (s.match(/\./g) || []).length;
      const commaCount = (s.match(/,/g) || []).length;

      if (dotCount >= 1 && commaCount === 1) {
        const commaIdx = s.lastIndexOf(',');
        const dotIdx = s.lastIndexOf('.');
        if (dotIdx < commaIdx) {
          s = s.replace(/\./g, '').replace(',', '.');
        } else {
          s = s.replace(/,/g, '');
        }
      } else if (commaCount >= 1 && dotCount === 0) {
        const parts = s.split(',');
        if (parts.length === 2 && parts[1].length <= 2) {
          s = s.replace(',', '.');
        } else {
          s = s.replace(/,/g, '');
        }
      } else if (dotCount >= 2) {
        s = s.replace(/\./g, '');
      } else if (dotCount === 1 && commaCount === 0) {
        const afterDot = s.split('.')[1] || '';
        if (afterDot.length === 3) {
          s = s.replace('.', '');
        }
      }

      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };

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

    console.log("Updating invoice with:", JSON.stringify(updateData));

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", invoiceId);

      if (updateError) {
        console.error("DB update error:", updateError);
        throw updateError;
      }
      console.log("✓ Invoice updated in DB");
    }

    let suggestedTags: unknown[] = [];
    try {
      const vendorName = String(updateData.supplier_name || '').trim();
      if (vendorName) {
        const { data: vendorTags } = await supabase
          .from('tag_learning')
          .select('tag_id, frequency, tags:tag_id(id, name, color)')
          .ilike('vendor_name', vendorName);

        if (vendorTags && vendorTags.length > 0) {
          suggestedTags = vendorTags
            .filter((i: Record<string, unknown>) => i.tags)
            .sort((a: Record<string, number>, b: Record<string, number>) => b.frequency - a.frequency)
            .slice(0, 3)
            .map((i: Record<string, unknown>) => {
              const t = i.tags as Record<string, unknown>;
              return { id: t.id, name: t.name, color: t.color, confidence: (i.frequency as number) * 2 };
            });
        }
      }
    } catch (e) {
      console.error("Tags suggestion error:", e);
    }

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
        if (hist && hist.length > 0) {
          const counts: Record<string, number> = {};
          for (const inv of hist) {
            const d = String(inv.description).trim();
            counts[d] = (counts[d] || 0) + 1;
          }
          suggestedDescription = Object.entries(counts).sort((a, b) => b[1] - a[1])[0][0];
        }
      }
      if (suggestedDescription) {
        const { data: cur } = await supabase.from('invoices').select('description').eq('id', invoiceId).maybeSingle();
        if (cur && (!cur.description || cur.description.trim() === '')) {
          await supabase.from('invoices').update({ description: suggestedDescription }).eq('id', invoiceId);
        }
      }
    } catch (e) {
      console.error("Description suggestion error:", e);
    }

    console.log("=== OCR COMPLETED ===");

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
        usedApi,
        suggestedTags,
        suggestedDescription,
        validationError: supplierErrorMessage,
        buyerError: buyerErrorMessage,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error("=== OCR FAILED ===", msg);
    return new Response(
      JSON.stringify({ error: msg }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
