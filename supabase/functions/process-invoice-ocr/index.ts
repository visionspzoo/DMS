import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import pdfParse from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OCRRequest {
  fileUrl?: string;
  invoiceId: string;
  pdfBase64?: string;
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
  "currency": "kod waluty: PLN, EUR, USD, GBP itp."
}

BARDZO WAŻNE - FORMATOWANIE KWOT:
- ZAWSZE zwracaj kwoty BEZ SPACJI (np. zamiast "7 564,62" zwróć "7564.62")
- ZAWSZE używaj KROPKI jako separatora dziesiętnego (nie przecinka)
- USUŃ wszystkie spacje z kwot
- Przykłady poprawnych konwersji:
  * "7 564,62" → "7564.62"
  * "1 234 567,89" → "1234567.89"
  * "123,45" → "123.45"
  * "1.234.567,89" → "1234567.89"
- Jeśli widzisz kwotę "7 564,62" to zwróć "7564.62", NIE "7" ani "7 564.62"

KRYTYCZNA ZASADA - IDENTYFIKACJA SPRZEDAWCY vs NABYWCY:

Na fakturze są zawsze DWA podmioty:
1. SPRZEDAWCA (Seller, Vendor, Supplier, Dostawca, Wystawca, Sprzedawca) - firma która WYSTAWIA fakturę → supplier_name, supplier_nip
2. NABYWCA (Buyer, Customer, Bill to, Bill To, Nabywca, Kupujący, Odbiorca) - firma która OTRZYMUJE fakturę → buyer_name, buyer_nip

ETYKIETY ANGIELSKIE I POLSKIE - DOKŁADNE TŁUMACZENIE:
SPRZEDAWCA (do pól supplier_*):
- "Seller:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Vendor:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Supplier:" = SPRZEDAWCA → supplier_name, supplier_nip
- "From:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Sprzedawca:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Wystawca:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Dostawca:" = SPRZEDAWCA → supplier_name, supplier_nip

NABYWCA (do pól buyer_*):
- "Bill to:" = NABYWCA → buyer_name, buyer_nip
- "Bill To:" = NABYWCA → buyer_name, buyer_nip
- "Buyer:" = NABYWCA → buyer_name, buyer_nip
- "Customer:" = NABYWCA → buyer_name, buyer_nip
- "Nabywca:" = NABYWCA → buyer_name, buyer_nip
- "Kupujący:" = NABYWCA → buyer_name, buyer_nip
- "Odbiorca:" = NABYWCA → buyer_name, buyer_nip

WAŻNE: Wyciągnij OBIE strony faktury - zarówno sprzedawcę JAK I nabywcę!

SZCZEGÓLNA UWAGA dla angielskich faktur:
- Jeśli widzisz sekcję "Bill to:" lub "Bill To:" - to jest NABYWCA, NIE SPRZEDAWCA
- "Bill to" NIGDY nie jest dostawcą (supplier)
- Szukaj sekcji "Seller:", "Vendor:", "From:" lub firmę w górnym lewym rogu

UKŁAD PRZESTRZENNY:
- Faktury polskie: LEWA strona/GÓRA = Sprzedawca, PRAWA/DÓŁ = Nabywca
- Faktury zagraniczne: często podobnie, lub Seller na górze, Bill to niżej

PRZYKŁAD 1 - Faktura angielska:
"Seller:
ABC Ltd
VAT: GB123456789

Bill to:
Aura Herbals sp. z o.o.
NIP: 5851490834"

POPRAWNA ODPOWIEDŹ:
supplier_name: "ABC Ltd"
supplier_nip: "GB123456789"
buyer_name: "Aura Herbals sp. z o.o."
buyer_nip: "5851490834"

PRZYKŁAD 2 - Faktura polska:
"Sprzedawca:
XYZ Sp. z o.o.
NIP: 1234567890

Nabywca:
Aura Herbals sp. z o.o.
NIP: 5851490834"

POPRAWNA ODPOWIEDŹ:
supplier_name: "XYZ Sp. z o.o."
supplier_nip: "1234567890"
buyer_name: "Aura Herbals sp. z o.o."
buyer_nip: "5851490834"

BŁĘDY DO UNIKNIĘCIA:
❌ NIE wpisuj firmy z sekcji "Bill to" jako supplier
❌ NIE wpisuj firmy z sekcji "Nabywca" jako supplier
✓ Wpisuj zarówno supplier JAK I buyer (to dwa różne pola!)

WERYFIKACJA KOŃCOWA:
Przed zwróceniem odpowiedzi, zapytaj siebie:
"Czy firma w supplier_name jest firmą która WYSTAWIA tę fakturę i SPRZEDAJE?"
Jeśli NIE - szukaj dalej!

DODATKOWE UWAGI:
- Akceptuj faktury w dowolnej walucie (PLN, EUR, USD, GBP itp.)
- Dla faktur zagranicznych: VAT ID, Tax ID, Tax Number
- Daty w formacie YYYY-MM-DD
- Kwoty jako stringi z kropką (nie przecinkiem)
- Walutę zapisz jako 3-literowy kod ISO
- Zwróć TYLKO JSON, bez \`\`\`json ani innych oznaczeń`;

async function extractTextFromPDF(fileBlob: Blob): Promise<string> {
  try {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error("PDF parsing error:", error);
    return "";
  }
}

function isTextSufficient(text: string): boolean {
  const cleaned = text.replace(/\s+/g, ' ').trim();
  return cleaned.length >= 100;
}

async function interpretWithClaude(fileUrl: string, apiKey: string, fileBlob: Blob, extractedText?: string) {
  const mimeType = fileBlob.type;
  const isPDF = mimeType === 'application/pdf';

  if (isPDF && extractedText) {
    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        system: INVOICE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: `Przeanalizuj poniższy tekst wyekstraktowany z faktury PDF i wyciągnij wszystkie dane zgodnie z instrukcjami.

KRYTYCZNE: Jeśli widzisz kwoty ze spacjami (np. "7 564,62"), usuń spacje i zamień przecinek na kropkę (zwróć "7564.62").

Odpowiedz TYLKO z JSON.\n\nTekst faktury:\n${extractedText}`
          }
        ],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } else if (!isPDF) {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    let mediaType = 'image/jpeg';
    if (mimeType === 'image/png') mediaType = 'image/png';
    else if (mimeType === 'image/jpeg' || mimeType === 'image/jpg') mediaType = 'image/jpeg';
    else if (mimeType === 'image/webp') mediaType = 'image/webp';
    else if (mimeType === 'image/gif') mediaType = 'image/gif';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model: 'claude-3-haiku-20240307',
        max_tokens: 2000,
        system: INVOICE_SYSTEM_PROMPT,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'image',
                source: {
                  type: 'base64',
                  media_type: mediaType,
                  data: base64,
                }
              },
              {
                type: 'text',
                text: 'Przeanalizuj tę fakturę i wyciągnij wszystkie dane zgodnie z instrukcjami. Odpowiedz TYLKO z JSON.'
              }
            ]
          }
        ],
        temperature: 0,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Claude API error: ${response.status} - ${errorText}`);
    }

    const data = await response.json();
    return data.content[0].text;
  } else {
    throw new Error('PDF file provided but no extracted text available');
  }
}

async function interpretWithGPT4o(fileBlob: Blob, apiKey: string, isPdfScan: boolean = false) {
  const mimeType = fileBlob.type;
  const arrayBuffer = await fileBlob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

  let imageMediaType: string;
  let imageData: string;

  if (mimeType === 'application/pdf' || isPdfScan) {
    imageMediaType = 'image/jpeg';
    imageData = base64;
  } else if (mimeType === 'image/png') {
    imageMediaType = 'image/png';
    imageData = base64;
  } else {
    imageMediaType = 'image/jpeg';
    imageData = base64;
  }

  const dataUrl = `data:${mimeType === 'application/pdf' ? 'application/pdf' : imageMediaType};base64,${imageData}`;

  const messages: any[] = [
    {
      role: 'user',
      content: [
        {
          type: 'text',
          text: `${INVOICE_SYSTEM_PROMPT}\n\nPrzeanalizuj tę fakturę i wyciągnij wszystkie dane zgodnie z instrukcjami. Odpowiedz TYLKO z JSON.`
        },
        {
          type: 'image_url',
          image_url: {
            url: dataUrl,
            detail: 'high'
          }
        }
      ]
    }
  ];

  const response = await fetch('https://api.openai.com/v1/chat/completions', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model: 'gpt-4o',
      messages,
      max_tokens: 2000,
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`GPT-4o API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

async function interpretWithMistral(fileUrl: string, fileBlob: Blob, apiKey: string) {
  const mimeType = fileBlob.type;

  if (mimeType === 'application/pdf') {
    throw new Error('Mistral Pixtral does not support PDF files. Use OpenAI GPT-4o or upload as image (JPG/PNG).');
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const dataUrl = `data:${mimeType};base64,${base64}`;

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
              text: INVOICE_SYSTEM_PROMPT + "\n\nPrzeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON."
            },
            {
              type: "image_url",
              image_url: dataUrl
            }
          ]
        }
      ],
      temperature: 0.1,
      max_tokens: 1000,
    }),
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${errorText}`);
  }

  const data = await response.json();
  return data.choices[0].message.content;
}

function createFallbackInterpretation() {
  console.log("Using fallback - no AI keys configured or AI failed");
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

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("=== OCR PROCESSING STARTED ===");

    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");

    console.log("API Keys configured:", {
      claude: !!claudeApiKey,
      openai: !!openaiApiKey,
      mistral: !!mistralApiKey,
    });

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { fileUrl, invoiceId, pdfBase64 }: OCRRequest = await req.json();

    console.log("Processing invoice:", { fileUrl: fileUrl ? 'provided' : 'none', invoiceId, pdfBase64: pdfBase64 ? 'provided' : 'none' });

    let content: string;
    let usedApi: string;
    let errorDetails: any = null;

    if (!claudeApiKey && !openaiApiKey && !mistralApiKey) {
      console.log("No API keys configured - using fallback");
      const fallback = createFallbackInterpretation();
      content = JSON.stringify(fallback);
      usedApi = "Fallback (no AI keys)";
    } else {
      let fileBlob: Blob;

      if (pdfBase64) {
        console.log("Using provided PDF base64 data...");
        const binaryString = atob(pdfBase64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBlob = new Blob([bytes], { type: 'application/pdf' });
        console.log(`✓ Converted base64 to blob, size: ${fileBlob.size} bytes`);
      } else if (fileUrl) {
        console.log("Fetching file from URL...");
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file: ${fileResponse.status}`);
        }
        fileBlob = await fileResponse.blob();
      } else {
        throw new Error("Either fileUrl or pdfBase64 must be provided");
      }

      const fileType = fileBlob.type;
      const isPDF = fileType === 'application/pdf';
      console.log(`File type: ${fileType}, size: ${fileBlob.size} bytes, isPDF: ${isPDF}`);

      if (isPDF) {
        console.log("PDF detected - extracting text...");
        const extractedText = await extractTextFromPDF(fileBlob);
        console.log(`Extracted ${extractedText.length} characters from PDF`);

        const hasEnoughText = isTextSufficient(extractedText);
        console.log(`Text sufficient for Claude: ${hasEnoughText}`);

        if (hasEnoughText && claudeApiKey) {
          try {
            console.log("PDF has readable text - sending to Claude...");
            content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob, extractedText);
            usedApi = "Claude 3 Haiku (PDF text extraction)";
            console.log("✓ Claude interpretation successful");
          } catch (claudeError) {
            console.error("Claude failed on PDF text, trying GPT-4o as fallback:", claudeError);
            errorDetails = { api: 'Claude', message: claudeError.message };

            if (openaiApiKey) {
              try {
                console.log("Falling back to GPT-4o for PDF...");
                content = await interpretWithGPT4o(fileBlob, openaiApiKey, true);
                usedApi = "GPT-4o Vision (fallback from Claude on PDF)";
                errorDetails = null;
                console.log("✓ GPT-4o interpretation successful");
              } catch (gptError) {
                console.error("GPT-4o also failed:", gptError);
                errorDetails.gptError = gptError.message;
                const fallback = createFallbackInterpretation();
                content = JSON.stringify(fallback);
                usedApi = "Fallback (Claude + GPT-4o failed on PDF)";
              }
            } else {
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (Claude failed, no GPT-4o)";
            }
          }
        } else {
          // Scanned PDF or very little text extracted - use GPT-4o Vision
          if (!hasEnoughText) {
            console.log("PDF appears to be a scan (insufficient text) - routing to GPT-4o Vision...");
          } else {
            console.log("No Claude key available for PDF text - routing to GPT-4o Vision...");
          }

          if (openaiApiKey) {
            try {
              content = await interpretWithGPT4o(fileBlob, openaiApiKey, true);
              usedApi = "GPT-4o Vision (scanned PDF)";
              console.log("✓ GPT-4o Vision interpretation successful");
            } catch (gptError) {
              console.error("GPT-4o failed on scanned PDF:", gptError);
              errorDetails = { api: 'GPT-4o', message: gptError.message };

              if (claudeApiKey && hasEnoughText) {
                try {
                  console.log("Trying Claude as fallback with available text...");
                  content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob, extractedText);
                  usedApi = "Claude 3 Haiku (fallback from GPT-4o)";
                  errorDetails = null;
                } catch (claudeError) {
                  const fallback = createFallbackInterpretation();
                  content = JSON.stringify(fallback);
                  usedApi = "Fallback (both GPT-4o and Claude failed)";
                }
              } else {
                const fallback = createFallbackInterpretation();
                content = JSON.stringify(fallback);
                usedApi = "Fallback (GPT-4o failed, no viable alternative)";
              }
            }
          } else if (claudeApiKey && hasEnoughText) {
            try {
              console.log("No GPT-4o key, using Claude with available text...");
              content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob, extractedText);
              usedApi = "Claude 3 Haiku (partial PDF text)";
              console.log("✓ Claude interpretation successful");
            } catch (claudeError) {
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (Claude failed on partial text)";
            }
          } else {
            console.log("No GPT-4o or Claude key for scanned PDF");
            const fallback = createFallbackInterpretation();
            content = JSON.stringify(fallback);
            usedApi = "Fallback (no suitable AI for scanned PDF)";
            errorDetails = { message: "Scanned PDF requires OPENAI_API_KEY for GPT-4o Vision" };
          }
        }
      } else {
        // Image file (JPG, PNG, etc.) - try Claude first, fall back to GPT-4o
        if (claudeApiKey) {
          try {
            console.log("Image file - using Claude Vision...");
            content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob);
            usedApi = "Claude 3 Haiku Vision";
            console.log("✓ Claude Vision interpretation successful");
          } catch (claudeError) {
            console.error("Claude Vision failed on image, trying GPT-4o:", claudeError);
            errorDetails = { api: 'Claude', message: claudeError.message };

            if (openaiApiKey) {
              try {
                console.log("Falling back to GPT-4o Vision for image...");
                content = await interpretWithGPT4o(fileBlob, openaiApiKey);
                usedApi = "GPT-4o Vision (fallback from Claude on image)";
                errorDetails = null;
                console.log("✓ GPT-4o Vision interpretation successful");
              } catch (gptError) {
                console.error("GPT-4o also failed:", gptError);
                errorDetails.gptError = gptError.message;

                if (mistralApiKey) {
                  try {
                    console.log("Falling back to Mistral...");
                    content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
                    usedApi = "Mistral Pixtral (fallback)";
                    errorDetails = null;
                  } catch (mistralError) {
                    const fallback = createFallbackInterpretation();
                    content = JSON.stringify(fallback);
                    usedApi = "Fallback (all vision APIs failed)";
                  }
                } else {
                  const fallback = createFallbackInterpretation();
                  content = JSON.stringify(fallback);
                  usedApi = "Fallback (Claude + GPT-4o failed on image)";
                }
              }
            } else if (mistralApiKey) {
              try {
                console.log("No GPT-4o, falling back to Mistral...");
                content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
                usedApi = "Mistral Pixtral (fallback from Claude)";
                errorDetails = null;
              } catch (mistralError) {
                const fallback = createFallbackInterpretation();
                content = JSON.stringify(fallback);
                usedApi = "Fallback (Claude + Mistral failed)";
              }
            } else {
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (Claude failed, no alternative)";
            }
          }
        } else if (openaiApiKey) {
          try {
            console.log("No Claude key - using GPT-4o Vision for image...");
            content = await interpretWithGPT4o(fileBlob, openaiApiKey);
            usedApi = "GPT-4o Vision";
            console.log("✓ GPT-4o Vision interpretation successful");
          } catch (gptError) {
            console.error("GPT-4o failed:", gptError);
            errorDetails = { api: 'GPT-4o', message: gptError.message };

            if (mistralApiKey) {
              try {
                content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
                usedApi = "Mistral Pixtral (fallback from GPT-4o)";
                errorDetails = null;
              } catch (mistralError) {
                const fallback = createFallbackInterpretation();
                content = JSON.stringify(fallback);
                usedApi = "Fallback (GPT-4o + Mistral failed)";
              }
            } else {
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (GPT-4o failed, no alternative)";
            }
          }
        } else if (mistralApiKey) {
          try {
            console.log("Using Mistral Pixtral for image...");
            content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
            usedApi = "Mistral Pixtral";
            console.log("✓ Mistral interpretation successful");
          } catch (mistralError) {
            console.error("Mistral failed:", mistralError);
            errorDetails = { api: 'Mistral', message: mistralError.message };
            const fallback = createFallbackInterpretation();
            content = JSON.stringify(fallback);
            usedApi = "Fallback (Mistral failed)";
          }
        } else {
          const fallback = createFallbackInterpretation();
          content = JSON.stringify(fallback);
          usedApi = "Fallback";
        }
      }
    }

    console.log(`Raw ${usedApi} response:`, content);

    let parsedData;
    try {
      const cleanContent = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedData = JSON.parse(cleanContent);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      console.log("Using fallback due to parse error");
      parsedData = createFallbackInterpretation();
      usedApi = `${usedApi} (parse error - fallback)`;
    }

    console.log("Parsed data:", parsedData);

    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    console.log("Existing invoice data:", existingInvoice);

    const COMPANY_NIPS = ['5851490834', '8222407812'];
    const CORRECT_BUYER_NIP = '5851490834';

    let hasSupplierError = false;
    let hasBuyerError = false;
    let supplierErrorMessage = null;
    let buyerErrorMessage = null;

    if (parsedData.supplier_nip) {
      const cleanSupplierNip = parsedData.supplier_nip.replace(/[^0-9]/g, '');
      if (COMPANY_NIPS.some(nip => cleanSupplierNip === nip)) {
        hasSupplierError = true;
        const companyName = cleanSupplierNip === '5851490834' ? 'Aura Herbals' : 'firma';
        supplierErrorMessage = `BŁĄD: AI pomyliło strony faktury - ${companyName} (NIP: ${cleanSupplierNip}) to NABYWCA (kupujący), nie SPRZEDAWCA (dostawca). Dane zostały oznaczone jako wymagające korekty.`;
        console.error(supplierErrorMessage);
        parsedData.supplier_name = `[BŁĄD: TO NABYWCA] ${parsedData.supplier_name || ''}`;
        parsedData.supplier_nip = `[BŁĄD] ${parsedData.supplier_nip}`;
      }
    }

    if (parsedData.buyer_nip) {
      const cleanBuyerNip = parsedData.buyer_nip.replace(/[^0-9]/g, '');
      if (cleanBuyerNip !== CORRECT_BUYER_NIP) {
        hasBuyerError = true;
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (NIP: ${parsedData.buyer_nip}). Oczekiwany odbiorca: Aura Herbals Sp. z o.o., NIP: 5851490834`;
        console.warn(buyerErrorMessage);
      }
    } else if (parsedData.buyer_name) {
      const buyerNameLower = parsedData.buyer_name.toLowerCase();
      if (!buyerNameLower.includes('aura') || !buyerNameLower.includes('herbals')) {
        hasBuyerError = true;
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (${parsedData.buyer_name}). Oczekiwany odbiorca: Aura Herbals Sp. z o.o., NIP: 5851490834`;
        console.warn(buyerErrorMessage);
      }
    }

    const updateData: any = {};

    if (!existingInvoice?.status || existingInvoice.status === '') {
      updateData.status = "draft";
    }

    if (parsedData.invoice_number) {
      updateData.invoice_number = parsedData.invoice_number;
    } else if (!existingInvoice?.invoice_number) {
      updateData.invoice_number = null;
    }

    if (parsedData.supplier_name) {
      updateData.supplier_name = parsedData.supplier_name;
    } else if (!existingInvoice?.supplier_name) {
      updateData.supplier_name = null;
    }

    if (parsedData.supplier_nip) {
      updateData.supplier_nip = parsedData.supplier_nip;
    } else if (!existingInvoice?.supplier_nip) {
      updateData.supplier_nip = null;
    }

    if (parsedData.buyer_name) {
      updateData.buyer_name = parsedData.buyer_name;
    } else if (!existingInvoice?.buyer_name) {
      updateData.buyer_name = null;
    }

    if (parsedData.buyer_nip) {
      updateData.buyer_nip = parsedData.buyer_nip;
    } else if (!existingInvoice?.buyer_nip) {
      updateData.buyer_nip = null;
    }

    if (parsedData.issue_date) {
      updateData.issue_date = parsedData.issue_date;
    } else if (!existingInvoice?.issue_date) {
      updateData.issue_date = null;
    }

    if (parsedData.due_date) {
      updateData.due_date = parsedData.due_date;
    } else if (!existingInvoice?.due_date) {
      updateData.due_date = null;
    }

    if (parsedData.currency) {
      updateData.currency = parsedData.currency;
    } else if (!existingInvoice?.currency) {
      updateData.currency = "PLN";
    }

    if (parsedData.net_amount !== undefined && parsedData.net_amount !== null && parsedData.net_amount !== '') {
      let netAmountStr = typeof parsedData.net_amount === 'string'
        ? parsedData.net_amount
        : parsedData.net_amount.toString();
      netAmountStr = netAmountStr.replace(/\s/g, '').replace(',', '.');
      const netAmount = parseFloat(netAmountStr);
      if (!isNaN(netAmount)) {
        updateData.net_amount = netAmount;
      }
    }

    if (parsedData.tax_amount !== undefined && parsedData.tax_amount !== null && parsedData.tax_amount !== '') {
      let taxAmountStr = typeof parsedData.tax_amount === 'string'
        ? parsedData.tax_amount
        : parsedData.tax_amount.toString();
      taxAmountStr = taxAmountStr.replace(/\s/g, '').replace(',', '.');
      const taxAmount = parseFloat(taxAmountStr);
      if (!isNaN(taxAmount)) {
        updateData.tax_amount = taxAmount;
      }
    }

    if (parsedData.gross_amount !== undefined && parsedData.gross_amount !== null && parsedData.gross_amount !== '') {
      let grossAmountStr = typeof parsedData.gross_amount === 'string'
        ? parsedData.gross_amount
        : parsedData.gross_amount.toString();
      grossAmountStr = grossAmountStr.replace(/\s/g, '').replace(',', '.');
      const grossAmount = parseFloat(grossAmountStr);
      if (!isNaN(grossAmount)) {
        updateData.gross_amount = grossAmount;
      }
    }

    const currency = updateData.currency || existingInvoice?.currency || parsedData.currency || "PLN";
    const issueDate = updateData.issue_date || existingInvoice?.issue_date || parsedData.issue_date || new Date().toISOString().split('T')[0];

    if (currency !== 'PLN') {
      console.log(`Fetching exchange rate for ${currency} on ${issueDate}...`);
      try {
        const rateResponse = await fetch(`${supabaseUrl}/functions/v1/get-exchange-rate`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${supabaseServiceKey}`,
          },
          body: JSON.stringify({
            currency: currency,
            date: issueDate,
          }),
        });

        if (rateResponse.ok) {
          const rateData = await rateResponse.json();
          updateData.exchange_rate = rateData.rate;
          updateData.exchange_rate_date = rateData.effectiveDate;
          console.log(`✓ Exchange rate: ${rateData.rate} (date: ${rateData.effectiveDate})`);
        } else {
          console.warn('Failed to fetch exchange rate, using 1.0 as default');
          updateData.exchange_rate = 1.0;
          updateData.exchange_rate_date = issueDate;
        }
      } catch (rateError) {
        console.error('Error fetching exchange rate:', rateError);
        updateData.exchange_rate = 1.0;
        updateData.exchange_rate_date = issueDate;
      }
    } else {
      updateData.exchange_rate = 1.0;
      updateData.exchange_rate_date = issueDate;
    }

    console.log("Updating invoice in database...", updateData);

    const { error: updateError } = await supabase
      .from("invoices")
      .update(updateData)
      .eq("id", invoiceId);

    if (updateError) {
      console.error("Database update error:", updateError);
      throw updateError;
    }

    console.log("✓ Invoice updated successfully");

    let suggestedTags = [];
    try {
      const vendorName = updateData.supplier_name?.trim() || '';

      if (vendorName) {
        console.log(`Searching tags for vendor: "${vendorName}"`);

        const { data: vendorTags, error: vendorError } = await supabase
          .from('tag_learning')
          .select(`
            tag_id,
            frequency,
            description_keywords,
            tags:tag_id (
              id,
              name,
              color
            )
          `)
          .ilike('vendor_name', vendorName);

        if (!vendorError && vendorTags && vendorTags.length > 0) {
          console.log(`✓ Found ${vendorTags.length} tags for this vendor`);
          suggestedTags = vendorTags
            .filter(item => item.tags)
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 3)
            .map(item => ({
              id: item.tags.id,
              name: item.tags.name,
              color: item.tags.color,
              confidence: item.frequency * 2,
            }));
        } else {
          const { data: allTags, error: allError } = await supabase
            .from('tag_learning')
            .select(`
              vendor_name,
              tag_id,
              frequency,
              description_keywords,
              tags:tag_id (
                id,
                name,
                color
              )
            `)
            .limit(100);

          if (!allError && allTags) {
            const similarTags = allTags.filter(item =>
              item.vendor_name &&
              item.vendor_name.toLowerCase().includes(vendorName.toLowerCase())
            );

            if (similarTags.length > 0) {
              suggestedTags = similarTags
                .filter(item => item.tags)
                .sort((a, b) => b.frequency - a.frequency)
                .slice(0, 3)
                .map(item => ({
                  id: item.tags.id,
                  name: item.tags.name,
                  color: item.tags.color,
                  confidence: item.frequency,
                }));
            }
          }
        }
      }
    } catch (tagError) {
      console.error("Error fetching suggested tags:", tagError);
    }

    let suggestedDescription: string | null = null;
    try {
      const vendorName = updateData.supplier_name?.trim() || '';
      const supplierNip = updateData.supplier_nip?.trim() || '';

      if (vendorName || supplierNip) {
        let query = supabase
          .from('invoices')
          .select('description')
          .not('description', 'is', null)
          .neq('description', '')
          .order('created_at', { ascending: false })
          .limit(50);

        if (supplierNip) {
          query = query.eq('supplier_nip', supplierNip);
        } else {
          query = query.ilike('supplier_name', vendorName);
        }

        const { data: historicalInvoices, error: histError } = await query;

        if (!histError && historicalInvoices && historicalInvoices.length > 0) {
          const descCounts: Record<string, number> = {};
          for (const inv of historicalInvoices) {
            const desc = inv.description.trim();
            descCounts[desc] = (descCounts[desc] || 0) + 1;
          }
          const sorted = Object.entries(descCounts).sort((a, b) => b[1] - a[1]);
          suggestedDescription = sorted[0][0];
        } else if (vendorName) {
          const { data: tagLearningData } = await supabase
            .from('tag_learning')
            .select('description_keywords')
            .ilike('vendor_name', vendorName)
            .not('description_keywords', 'is', null)
            .order('frequency', { ascending: false })
            .limit(5);

          if (tagLearningData && tagLearningData.length > 0) {
            const allKeywords: string[] = [];
            for (const row of tagLearningData) {
              if (row.description_keywords) {
                allKeywords.push(...row.description_keywords);
              }
            }
            const unique = [...new Set(allKeywords)].slice(0, 6);
            if (unique.length > 0) {
              suggestedDescription = unique.join(', ');
            }
          }
        }
      }
    } catch (descError) {
      console.error("Error looking up historical descriptions:", descError);
    }

    if (suggestedDescription && invoiceId) {
      const { data: currentInv } = await supabase
        .from('invoices')
        .select('description')
        .eq('id', invoiceId)
        .maybeSingle();

      if (currentInv && (!currentInv.description || currentInv.description.trim() === '')) {
        await supabase
          .from('invoices')
          .update({ description: suggestedDescription })
          .eq('id', invoiceId);
      }
    }

    console.log("=== OCR PROCESSING COMPLETED ===");

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
        usedApi,
        error: errorDetails,
        suggestedTags,
        suggestedDescription,
        validationError: hasSupplierError ? supplierErrorMessage : null,
        buyerError: hasBuyerError ? buyerErrorMessage : null,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("=== OCR PROCESSING FAILED ===");
    console.error("Error:", error);
    return new Response(
      JSON.stringify({
        error: error.message,
        details: error.toString()
      }),
      {
        status: 500,
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  }
});
