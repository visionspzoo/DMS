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
  "currency": "kod waluty: PLN, EUR, USD, GBP itp."
}

BARDZO WAŻNE - FORMATOWANIE KWOT:
- ZAWSZE zwracaj kwoty BEZ SPACJI (np. zamiast "7 564,62" zwróć "7564.62")
- ZAWSZE używaj KROPKI jako separatora dziesiętnego (nie przecinka)
- USUŃ wszystkie spacje z kwot
- Przykłady: "7 564,62" → "7564.62", "1 234 567,89" → "1234567.89", "123,45" → "123.45"

KRYTYCZNA ZASADA - IDENTYFIKACJA SPRZEDAWCY vs NABYWCY:
1. SPRZEDAWCA (Seller, Vendor, Supplier, Dostawca, Wystawca, Sprzedawca) - firma która WYSTAWIA fakturę → supplier_name, supplier_nip
2. NABYWCA (Buyer, Customer, Bill to, Nabywca, Kupujący, Odbiorca) - firma która OTRZYMUJE fakturę → buyer_name, buyer_nip

- Faktury polskie: LEWA strona/GÓRA = Sprzedawca, PRAWA/DÓŁ = Nabywca
- "Bill to:" ZAWSZE = NABYWCA, nigdy Sprzedawca
- Szukaj etykiet: "Sprzedawca:", "Nabywca:", "Seller:", "Buyer:", "From:", "Bill to:"

DODATKOWE UWAGI:
- Akceptuj faktury w dowolnej walucie (PLN, EUR, USD, GBP itp.)
- Daty w formacie YYYY-MM-DD
- Walutę zapisz jako 3-literowy kod ISO
- Zwróć TYLKO JSON, bez \`\`\`json ani innych oznaczeń`;

async function extractTextFromPDF(pdfBlob: Blob): Promise<string> {
  try {
    const arrayBuffer = await pdfBlob.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const data = await pdfParse(buffer);
    return data.text || "";
  } catch (error) {
    console.error("PDF parsing error:", error);
    return "";
  }
}

function isTextSufficient(text: string): boolean {
  return text.replace(/\s+/g, ' ').trim().length >= 100;
}

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

async function interpretWithClaudeText(extractedText: string, apiKey: string): Promise<string> {
  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: INVOICE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: `Przeanalizuj poniższy tekst wyekstraktowany z faktury PDF i wyciągnij wszystkie dane.\n\nKRYTYCZNE: Kwoty ze spacjami (np. "7 564,62") zamień na "7564.62".\n\nOdpowiedz TYLKO z JSON.\n\nTekst faktury:\n${extractedText}`
        }
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude text API error: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

async function interpretWithClaudeVision(base64Data: string, resolvedMimeType: string, apiKey: string): Promise<string> {
  let mediaBlock: any;

  if (resolvedMimeType === 'application/pdf') {
    mediaBlock = {
      type: 'document',
      source: {
        type: 'base64',
        media_type: 'application/pdf',
        data: base64Data,
      }
    };
  } else {
    const imageMime = resolvedMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
    mediaBlock = {
      type: 'image',
      source: {
        type: 'base64',
        media_type: imageMime,
        data: base64Data,
      }
    };
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'x-api-key': apiKey,
    'anthropic-version': '2023-06-01',
  };

  if (resolvedMimeType === 'application/pdf') {
    headers['anthropic-beta'] = 'pdfs-2024-09-25';
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      model: 'claude-3-5-sonnet-20241022',
      max_tokens: 2000,
      system: INVOICE_SYSTEM_PROMPT,
      messages: [
        {
          role: 'user',
          content: [
            mediaBlock,
            {
              type: 'text',
              text: 'Przeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON.'
            }
          ]
        }
      ],
      temperature: 0,
    }),
  });

  if (!response.ok) {
    const err = await response.text();
    throw new Error(`Claude vision API error: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return data.content[0].text;
}

async function interpretWithGPT4oVision(base64Data: string, resolvedMimeType: string, apiKey: string): Promise<string> {
  const imageMime = resolvedMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
  const dataUrl = `data:${imageMime};base64,${base64Data}`;

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
              text: `${INVOICE_SYSTEM_PROMPT}\n\nPrzeanalizuj tę fakturę i wyciągnij wszystkie dane. Odpowiedz TYLKO z JSON.`
            },
            {
              type: 'image_url',
              image_url: {
                url: dataUrl,
                detail: 'high',
              }
            }
          ]
        }
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

async function interpretWithMistralVision(base64Data: string, resolvedMimeType: string, apiKey: string): Promise<string> {
  const imageMime = resolvedMimeType === 'image/png' ? 'image/png' : 'image/jpeg';
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
    const err = await response.text();
    throw new Error(`Mistral API error: ${response.status} - ${err}`);
  }
  const data = await response.json();
  return data.choices[0].message.content;
}

function createFallbackInterpretation() {
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
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    console.log("=== OCR PROCESSING STARTED ===");

    const claudeApiKey = Deno.env.get("ANTHROPIC_API_KEY");
    const openaiApiKey = Deno.env.get("OPENAI_API_KEY");
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    console.log("API Keys:", { claude: !!claudeApiKey, openai: !!openaiApiKey, mistral: !!mistralApiKey });

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const body: OCRRequest = await req.json();
    const { fileUrl, invoiceId, pdfBase64, fileBase64, mimeType: requestMimeType } = body;

    console.log("Invoice:", invoiceId, "mimeType:", requestMimeType, "hasBase64:", !!(fileBase64 || pdfBase64), "hasUrl:", !!fileUrl);

    let content: string;
    let usedApi: string;
    let errorDetails: any = null;

    if (!claudeApiKey && !openaiApiKey && !mistralApiKey) {
      console.log("No API keys - using fallback");
      content = JSON.stringify(createFallbackInterpretation());
      usedApi = "Fallback (no AI keys)";
    } else {
      // Determine MIME type
      let resolvedMimeType = requestMimeType || 'application/pdf';

      // Fetch file blob — always fetch from URL for PDFs so pdf-parse can work reliably,
      // for images use provided base64 or fetch from URL
      let fileBlob: Blob;

      if (fileUrl) {
        console.log("Fetching file from URL...");
        const fileResponse = await fetch(fileUrl);
        if (!fileResponse.ok) {
          throw new Error(`Failed to fetch file: ${fileResponse.status}`);
        }
        fileBlob = await fileResponse.blob();

        // Detect MIME type from response headers or URL extension
        const ct = fileResponse.headers.get('content-type') || '';
        if (ct && ct !== 'application/octet-stream' && ct !== 'binary/octet-stream') {
          resolvedMimeType = ct.split(';')[0].trim();
        } else if (fileUrl.match(/\.(jpg|jpeg)(\?|$)/i)) {
          resolvedMimeType = 'image/jpeg';
        } else if (fileUrl.match(/\.png(\?|$)/i)) {
          resolvedMimeType = 'image/png';
        } else {
          resolvedMimeType = requestMimeType || 'application/pdf';
        }
        console.log(`Fetched file: ${resolvedMimeType}, ${fileBlob.size} bytes`);
      } else if (fileBase64 || pdfBase64) {
        const b64 = fileBase64 || pdfBase64!;
        const binaryString = atob(b64);
        const bytes = new Uint8Array(binaryString.length);
        for (let i = 0; i < binaryString.length; i++) {
          bytes[i] = binaryString.charCodeAt(i);
        }
        fileBlob = new Blob([bytes], { type: resolvedMimeType });
        console.log(`Decoded base64 blob: ${resolvedMimeType}, ${fileBlob.size} bytes`);
      } else {
        throw new Error("Neither fileUrl nor base64 provided");
      }

      const isPDF = resolvedMimeType === 'application/pdf';
      console.log(`isPDF: ${isPDF}, resolvedMimeType: ${resolvedMimeType}`);

      if (isPDF) {
        // Extract text to decide: text path (Claude text) vs vision path (Claude PDF vision)
        console.log("Extracting text from PDF...");
        const extractedText = await extractTextFromPDF(fileBlob);
        console.log(`Extracted ${extractedText.length} chars`);
        const hasEnoughText = isTextSufficient(extractedText);
        console.log(`Text sufficient: ${hasEnoughText}`);

        if (hasEnoughText && claudeApiKey) {
          // Regular PDF with readable text → Claude text (fast and reliable)
          try {
            console.log("Regular PDF → Claude text analysis...");
            content = await interpretWithClaudeText(extractedText, claudeApiKey);
            usedApi = "Claude 3.5 Sonnet (PDF text)";
            console.log("✓ Claude text success");
          } catch (err: any) {
            console.error("Claude text failed:", err.message);
            errorDetails = { api: 'Claude text', message: err.message };

            // Fallback: Claude vision on PDF
            if (claudeApiKey) {
              try {
                console.log("Fallback: Claude PDF vision...");
                const b64 = await blobToBase64(fileBlob);
                content = await interpretWithClaudeVision(b64, 'application/pdf', claudeApiKey);
                usedApi = "Claude 3.5 Sonnet Vision PDF (fallback)";
                errorDetails = null;
                console.log("✓ Claude PDF vision success");
              } catch (vErr: any) {
                console.error("Claude PDF vision also failed:", vErr.message);
                content = JSON.stringify(createFallbackInterpretation());
                usedApi = "Fallback (Claude text + vision failed)";
              }
            } else {
              content = JSON.stringify(createFallbackInterpretation());
              usedApi = "Fallback (Claude failed, no alternative)";
            }
          }
        } else {
          // Scanned PDF (little/no extractable text) → Claude PDF vision (native PDF support)
          if (!hasEnoughText) {
            console.log("Scanned PDF detected → Claude PDF vision...");
          } else {
            console.log("No Claude key for PDF text → Claude PDF vision or GPT-4o...");
          }

          if (claudeApiKey) {
            try {
              const b64 = await blobToBase64(fileBlob);
              content = await interpretWithClaudeVision(b64, 'application/pdf', claudeApiKey);
              usedApi = "Claude 3.5 Sonnet Vision (scanned PDF)";
              console.log("✓ Claude PDF vision success");
            } catch (err: any) {
              console.error("Claude PDF vision failed:", err.message);
              errorDetails = { api: 'Claude PDF vision', message: err.message };

              // GPT-4o can't directly read PDFs via image_url, so we fallback to text if available
              if (hasEnoughText && claudeApiKey) {
                try {
                  content = await interpretWithClaudeText(extractedText, claudeApiKey);
                  usedApi = "Claude 3.5 Sonnet text (fallback from vision)";
                  errorDetails = null;
                } catch {
                  content = JSON.stringify(createFallbackInterpretation());
                  usedApi = "Fallback (all PDF paths failed)";
                }
              } else {
                content = JSON.stringify(createFallbackInterpretation());
                usedApi = "Fallback (Claude PDF vision failed)";
              }
            }
          } else if (openaiApiKey && hasEnoughText) {
            // No Claude but have GPT-4o: only works for text extraction path
            console.log("No Claude, using extracted text with... no GPT-4o text path. Fallback.");
            content = JSON.stringify(createFallbackInterpretation());
            usedApi = "Fallback (no Claude for PDF vision)";
            errorDetails = { message: "Scanned PDF processing requires ANTHROPIC_API_KEY for Claude PDF Vision" };
          } else {
            content = JSON.stringify(createFallbackInterpretation());
            usedApi = "Fallback (no suitable AI for scanned PDF)";
          }
        }
      } else {
        // Image file (JPG, PNG) → Claude vision first, then GPT-4o, then Mistral
        console.log(`Image file (${resolvedMimeType}) - preparing for vision...`);
        const b64 = await blobToBase64(fileBlob);

        if (claudeApiKey) {
          try {
            console.log("Image → Claude vision...");
            content = await interpretWithClaudeVision(b64, resolvedMimeType, claudeApiKey);
            usedApi = "Claude 3.5 Sonnet Vision (image)";
            console.log("✓ Claude image vision success");
          } catch (err: any) {
            console.error("Claude image vision failed:", err.message);
            errorDetails = { api: 'Claude image', message: err.message };

            if (openaiApiKey) {
              try {
                console.log("Fallback: GPT-4o vision...");
                content = await interpretWithGPT4oVision(b64, resolvedMimeType, openaiApiKey);
                usedApi = "GPT-4o Vision (image fallback)";
                errorDetails = null;
                console.log("✓ GPT-4o vision success");
              } catch (gErr: any) {
                console.error("GPT-4o also failed:", gErr.message);
                errorDetails.gptError = gErr.message;

                if (mistralApiKey) {
                  try {
                    content = await interpretWithMistralVision(b64, resolvedMimeType, mistralApiKey);
                    usedApi = "Mistral Pixtral (image fallback)";
                    errorDetails = null;
                  } catch {
                    content = JSON.stringify(createFallbackInterpretation());
                    usedApi = "Fallback (all image vision APIs failed)";
                  }
                } else {
                  content = JSON.stringify(createFallbackInterpretation());
                  usedApi = "Fallback (Claude + GPT-4o failed)";
                }
              }
            } else if (mistralApiKey) {
              try {
                content = await interpretWithMistralVision(b64, resolvedMimeType, mistralApiKey);
                usedApi = "Mistral Pixtral (image fallback from Claude)";
                errorDetails = null;
              } catch {
                content = JSON.stringify(createFallbackInterpretation());
                usedApi = "Fallback (Claude + Mistral failed)";
              }
            } else {
              content = JSON.stringify(createFallbackInterpretation());
              usedApi = "Fallback (Claude failed, no alternative)";
            }
          }
        } else if (openaiApiKey) {
          try {
            console.log("No Claude → GPT-4o vision for image...");
            content = await interpretWithGPT4oVision(b64, resolvedMimeType, openaiApiKey);
            usedApi = "GPT-4o Vision (image)";
            console.log("✓ GPT-4o vision success");
          } catch (err: any) {
            console.error("GPT-4o failed:", err.message);
            errorDetails = { api: 'GPT-4o', message: err.message };

            if (mistralApiKey) {
              try {
                content = await interpretWithMistralVision(b64, resolvedMimeType, mistralApiKey);
                usedApi = "Mistral Pixtral (image fallback from GPT-4o)";
                errorDetails = null;
              } catch {
                content = JSON.stringify(createFallbackInterpretation());
                usedApi = "Fallback (GPT-4o + Mistral failed)";
              }
            } else {
              content = JSON.stringify(createFallbackInterpretation());
              usedApi = "Fallback (GPT-4o failed)";
            }
          }
        } else if (mistralApiKey) {
          try {
            console.log("Using Mistral Pixtral for image...");
            content = await interpretWithMistralVision(b64, resolvedMimeType, mistralApiKey);
            usedApi = "Mistral Pixtral (image)";
            console.log("✓ Mistral vision success");
          } catch (err: any) {
            console.error("Mistral failed:", err.message);
            content = JSON.stringify(createFallbackInterpretation());
            usedApi = "Fallback (Mistral failed)";
          }
        } else {
          content = JSON.stringify(createFallbackInterpretation());
          usedApi = "Fallback";
        }
      }
    }

    console.log(`Used API: ${usedApi}`);
    console.log(`Raw response:`, content.substring(0, 300));

    let parsedData;
    try {
      const clean = content.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      parsedData = JSON.parse(clean);
    } catch (e) {
      console.error("Failed to parse AI response:", content);
      parsedData = createFallbackInterpretation();
      usedApi = `${usedApi} (parse error)`;
    }

    console.log("Parsed data:", JSON.stringify(parsedData));

    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    const COMPANY_NIPS = ['5851490834', '8222407812'];
    const CORRECT_BUYER_NIP = '5851490834';

    let hasSupplierError = false;
    let hasBuyerError = false;
    let supplierErrorMessage = null;
    let buyerErrorMessage = null;

    if (parsedData.supplier_nip) {
      const clean = parsedData.supplier_nip.replace(/[^0-9]/g, '');
      if (COMPANY_NIPS.some(n => clean === n)) {
        hasSupplierError = true;
        const cname = clean === '5851490834' ? 'Aura Herbals' : 'firma';
        supplierErrorMessage = `BŁĄD: AI pomyliło strony faktury - ${cname} (NIP: ${clean}) to NABYWCA, nie SPRZEDAWCA.`;
        console.error(supplierErrorMessage);
        parsedData.supplier_name = `[BŁĄD: TO NABYWCA] ${parsedData.supplier_name || ''}`;
        parsedData.supplier_nip = `[BŁĄD] ${parsedData.supplier_nip}`;
      }
    }

    if (parsedData.buyer_nip) {
      const clean = parsedData.buyer_nip.replace(/[^0-9]/g, '');
      if (clean !== CORRECT_BUYER_NIP) {
        hasBuyerError = true;
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (NIP: ${parsedData.buyer_nip}).`;
        console.warn(buyerErrorMessage);
      }
    } else if (parsedData.buyer_name) {
      const bn = parsedData.buyer_name.toLowerCase();
      if (!bn.includes('aura') || !bn.includes('herbals')) {
        hasBuyerError = true;
        buyerErrorMessage = `BŁĘDNY ODBIORCA: Faktura wystawiona na inną firmę (${parsedData.buyer_name}).`;
        console.warn(buyerErrorMessage);
      }
    }

    const updateData: any = {};

    if (parsedData.invoice_number) updateData.invoice_number = parsedData.invoice_number;
    if (parsedData.supplier_name) updateData.supplier_name = parsedData.supplier_name;
    if (parsedData.supplier_nip) updateData.supplier_nip = parsedData.supplier_nip;
    if (parsedData.buyer_name) updateData.buyer_name = parsedData.buyer_name;
    if (parsedData.buyer_nip) updateData.buyer_nip = parsedData.buyer_nip;
    if (parsedData.issue_date) updateData.issue_date = parsedData.issue_date;
    if (parsedData.due_date) updateData.due_date = parsedData.due_date;
    if (parsedData.currency) updateData.currency = parsedData.currency;

    const parseAmount = (val: any): number | null => {
      if (val === null || val === undefined || val === '') return null;
      const s = String(val).replace(/\s/g, '').replace(',', '.');
      const n = parseFloat(s);
      return isNaN(n) ? null : n;
    };

    const net = parseAmount(parsedData.net_amount);
    const tax = parseAmount(parsedData.tax_amount);
    const gross = parseAmount(parsedData.gross_amount);
    if (net !== null) updateData.net_amount = net;
    if (tax !== null) updateData.tax_amount = tax;
    if (gross !== null) updateData.gross_amount = gross;

    const currency = updateData.currency || existingInvoice?.currency || 'PLN';
    const issueDate = updateData.issue_date || existingInvoice?.issue_date || new Date().toISOString().split('T')[0];

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

    console.log("Updating invoice:", JSON.stringify(updateData));

    if (Object.keys(updateData).length > 0) {
      const { error: updateError } = await supabase
        .from("invoices")
        .update(updateData)
        .eq("id", invoiceId);

      if (updateError) {
        console.error("DB update error:", updateError);
        throw updateError;
      }
      console.log("✓ Invoice updated");
    }

    // Suggested tags
    let suggestedTags: any[] = [];
    try {
      const vendorName = updateData.supplier_name?.trim() || '';
      if (vendorName) {
        const { data: vendorTags } = await supabase
          .from('tag_learning')
          .select('tag_id, frequency, tags:tag_id(id, name, color)')
          .ilike('vendor_name', vendorName);

        if (vendorTags && vendorTags.length > 0) {
          suggestedTags = vendorTags
            .filter(i => i.tags)
            .sort((a, b) => b.frequency - a.frequency)
            .slice(0, 3)
            .map(i => ({ id: i.tags.id, name: i.tags.name, color: i.tags.color, confidence: i.frequency * 2 }));
        }
      }
    } catch (e) {
      console.error("Tags error:", e);
    }

    // Suggested description
    let suggestedDescription: string | null = null;
    try {
      const vendorName = updateData.supplier_name?.trim() || '';
      const supplierNip = updateData.supplier_nip?.trim() || '';
      if (vendorName || supplierNip) {
        let q = supabase.from('invoices').select('description')
          .not('description', 'is', null).neq('description', '')
          .order('created_at', { ascending: false }).limit(50);
        if (supplierNip) q = q.eq('supplier_nip', supplierNip);
        else q = q.ilike('supplier_name', vendorName);
        const { data: hist } = await q;
        if (hist && hist.length > 0) {
          const counts: Record<string, number> = {};
          for (const inv of hist) { const d = inv.description.trim(); counts[d] = (counts[d] || 0) + 1; }
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
        error: errorDetails,
        suggestedTags,
        suggestedDescription,
        validationError: hasSupplierError ? supplierErrorMessage : null,
        buyerError: hasBuyerError ? buyerErrorMessage : null,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("=== OCR FAILED ===", error);
    return new Response(
      JSON.stringify({ error: error.message, details: error.toString() }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
