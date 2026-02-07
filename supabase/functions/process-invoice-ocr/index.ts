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

async function extractTextFromPDF(fileBlob: Blob): Promise<string> {
  try {
    const arrayBuffer = await fileBlob.arrayBuffer();
    const buffer = new Uint8Array(arrayBuffer);
    const data = await pdfParse(buffer);
    return data.text;
  } catch (error) {
    console.error("PDF parsing error:", error);
    throw new Error(`Failed to extract text from PDF: ${error.message}`);
  }
}

async function interpretWithClaude(fileUrl: string, apiKey: string, fileBlob: Blob, extractedText?: string) {
  const systemPrompt = `Jesteś ekspertem w analizie faktur VAT (polskich i zagranicznych).
Przeanalizuj dokument i zwróć TYLKO czysty JSON bez komentarzy, markdown czy dodatkowego tekstu.

Format odpowiedzi (DOKŁADNIE te pola):
{
  "invoice_number": "numer faktury lub null",
  "supplier_name": "nazwa SPRZEDAWCY (wystawcy faktury) lub null",
  "supplier_nip": "NIP/VAT ID/Tax ID SPRZEDAWCY (wystawcy faktury) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "kwota netto jako string z kropką np. 1234.56",
  "tax_amount": "kwota VAT jako string z kropką",
  "gross_amount": "kwota brutto jako string z kropką",
  "currency": "kod waluty: PLN, EUR, USD, GBP itp."
}

KRYTYCZNA ZASADA - IDENTYFIKACJA SPRZEDAWCY vs NABYWCY:

Na fakturze są zawsze DWA podmioty:
1. SPRZEDAWCA (Seller, Vendor, Supplier, Dostawca, Wystawca, Sprzedawca) - firma która WYSTAWIA fakturę
2. NABYWCA (Buyer, Customer, Bill to, Bill To, Nabywca, Kupujący, Odbiorca) - firma która OTRZYMUJE fakturę

ETYKIETY ANGIELSKIE I POLSKIE - DOKŁADNE TŁUMACZENIE:
- "Seller:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Vendor:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Supplier:" = SPRZEDAWCA → supplier_name, supplier_nip
- "From:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Sprzedawca:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Wystawca:" = SPRZEDAWCA → supplier_name, supplier_nip
- "Dostawca:" = SPRZEDAWCA → supplier_name, supplier_nip

NIE WPISUJ DO supplier_name/supplier_nip firm oznaczonych jako:
- "Bill to:" = NABYWCA (nie supplier!)
- "Bill To:" = NABYWCA (nie supplier!)
- "Buyer:" = NABYWCA (nie supplier!)
- "Customer:" = NABYWCA (nie supplier!)
- "Nabywca:" = NABYWCA (nie supplier!)
- "Kupujący:" = NABYWCA (nie supplier!)
- "Odbiorca:" = NABYWCA (nie supplier!)

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

BŁĘDY DO UNIKNIĘCIA:
❌ NIE wpisuj firmy z sekcji "Bill to" jako supplier
❌ NIE wpisuj firmy z sekcji "Nabywca" jako supplier
❌ NIE wpisuj "Aura Herbals" jako supplier (to zawsze nabywca w tym systemie)

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

  const mimeType = fileBlob.type;
  const isPDF = mimeType === 'application/pdf';

  if (isPDF && extractedText) {
    // For PDF with extracted text, use text-only analysis
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
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: `Przeanalizuj poniższy tekst wyekstraktowany z faktury PDF i wyciągnij wszystkie dane zgodnie z instrukcjami. Odpowiedz TYLKO z JSON.\n\nTekst faktury:\n${extractedText}`
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
    // For images, use vision capabilities
    const arrayBuffer = await fileBlob.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));

    // Determine media type
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
        system: systemPrompt,
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

async function interpretWithMistral(fileUrl: string, fileBlob: Blob, apiKey: string) {
  const mimeType = fileBlob.type;

  if (mimeType === 'application/pdf') {
    throw new Error('Mistral Pixtral does not support PDF files. Use OpenAI GPT-4o or upload as image (JPG/PNG).');
  }

  const arrayBuffer = await fileBlob.arrayBuffer();
  const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
  const dataUrl = `data:${mimeType};base64,${base64}`;

  const systemPrompt = `Jesteś ekspertem w analizie faktur VAT (polskich i zagranicznych).
Przeanalizuj obraz faktury i zwróć TYLKO czysty JSON bez komentarzy.

Format odpowiedzi:
{
  "invoice_number": "numer faktury lub null",
  "supplier_name": "nazwa SPRZEDAWCY (wystawcy faktury) lub null",
  "supplier_nip": "NIP/VAT ID/Tax ID SPRZEDAWCY (wystawcy faktury) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "string z kropką",
  "tax_amount": "string z kropką",
  "gross_amount": "string z kropką",
  "currency": "kod waluty (PLN/EUR/USD/GBP itp.)"
}

KRYTYCZNE ZASADY IDENTYFIKACJI STRON:
1. SPRZEDAWCA (dostawca/wystawca/seller/vendor) = ten kto WYSTAWIŁ fakturę i SPRZEDAJE → jego dane do supplier_name/supplier_nip
2. NABYWCA (kupujący/odbiorca/buyer) = ten kto KUPUJE i OTRZYMUJE fakturę → NIE wpisywać w supplier!
- Na polskich fakturach: lewa strona/góra = Sprzedawca, prawa/dół = Nabywca
- Szukaj etykiet: "Sprzedawca:", "Nabywca:", "Seller:", "Buyer:"
- NIE MYL nabywcy ze sprzedawcą!

DODATKOWE UWAGI:
- Akceptuj faktury w dowolnej walucie
- Dla faktur zagranicznych: znajdź VAT ID, Tax ID SPRZEDAWCY
- Walutę zapisz jako 3-literowy kod ISO`;

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
              text: systemPrompt
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
    issue_date: null,
    due_date: null,
    net_amount: "0.00",
    tax_amount: "0.00",
    gross_amount: "0.00",
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
    const mistralApiKey = Deno.env.get("MISTRAL_API_KEY");

    console.log("API Keys configured:", {
      claude: !!claudeApiKey,
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

    if (!claudeApiKey && !mistralApiKey) {
      console.log("No API keys configured - using fallback");
      const fallback = createFallbackInterpretation();
      content = JSON.stringify(fallback);
      usedApi = "Fallback (no AI keys)";
    } else {
      let fileBlob: Blob;

      // If pdfBase64 is provided, use it directly
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
        try {
          const extractedText = await extractTextFromPDF(fileBlob);
          console.log(`✓ Extracted ${extractedText.length} characters from PDF`);

          if (claudeApiKey) {
            try {
              console.log("Sending extracted text to Claude...");
              content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob, extractedText);
              usedApi = "Claude 3.5 Sonnet (PDF text extraction)";
              console.log("✓ Claude interpretation successful");
            } catch (error) {
              console.error("Claude failed:", error);
              errorDetails = {
                api: 'Claude',
                message: error.message || error.toString(),
                stack: error.stack,
              };
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (Claude failed on PDF text)";
            }
          } else {
            console.log("No Claude key - PDF text extraction requires Claude");
            const fallback = createFallbackInterpretation();
            content = JSON.stringify(fallback);
            usedApi = "Fallback (no Claude for PDF)";
            errorDetails = {
              message: "PDF processing requires ANTHROPIC_API_KEY",
            };
          }
        } catch (pdfError) {
          console.error("PDF extraction failed:", pdfError);
          errorDetails = {
            message: `Failed to extract text from PDF: ${pdfError.message}`,
            error: pdfError.toString(),
          };
          const fallback = createFallbackInterpretation();
          content = JSON.stringify(fallback);
          usedApi = "Fallback (PDF extraction failed)";
        }
      } else if (claudeApiKey) {
        try {
          console.log("Using Claude Vision for image...");
          content = await interpretWithClaude(fileUrl, claudeApiKey, fileBlob);
          usedApi = "Claude 3.5 Sonnet Vision";
          console.log("✓ Claude interpretation successful");
        } catch (error) {
          console.error("Claude failed:", error);
          errorDetails = {
            api: 'Claude',
            message: error.message || error.toString(),
            stack: error.stack,
          };
          if (mistralApiKey) {
            console.log("Falling back to Mistral...");
            try {
              content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
              usedApi = "Mistral Pixtral (fallback)";
              errorDetails = null;
            } catch (mistralError) {
              console.error("Mistral also failed:", mistralError);
              errorDetails.mistralError = mistralError.message || mistralError.toString();
              const fallback = createFallbackInterpretation();
              content = JSON.stringify(fallback);
              usedApi = "Fallback (both APIs failed)";
            }
          } else {
            const fallback = createFallbackInterpretation();
            content = JSON.stringify(fallback);
            usedApi = "Fallback (Claude failed, no Mistral)";
          }
        }
      } else if (mistralApiKey) {
        try {
          console.log("Using Mistral Pixtral for image...");
          content = await interpretWithMistral(fileUrl, fileBlob, mistralApiKey);
          usedApi = "Mistral Pixtral";
          console.log("✓ Mistral interpretation successful");
        } catch (error) {
          console.error("Mistral failed:", error);
          errorDetails = {
            api: 'Mistral',
            message: error.message || error.toString(),
            stack: error.stack,
          };
          const fallback = createFallbackInterpretation();
          content = JSON.stringify(fallback);
          usedApi = "Fallback (Mistral failed, no Claude)";
        }
      } else {
        const fallback = createFallbackInterpretation();
        content = JSON.stringify(fallback);
        usedApi = "Fallback";
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

    // First, get the existing invoice to preserve values
    const { data: existingInvoice } = await supabase
      .from("invoices")
      .select("*")
      .eq("id", invoiceId)
      .maybeSingle();

    console.log("Existing invoice data:", existingInvoice);

    // Validate supplier NIP - check if it's a company NIP (buyer should be our company, not supplier)
    const COMPANY_NIPS = ['5851490834', '8222407812']; // Aura Herbals and other company NIPs
    let hasSupplierError = false;
    let supplierErrorMessage = null;

    if (parsedData.supplier_nip) {
      const cleanSupplierNip = parsedData.supplier_nip.replace(/[^0-9]/g, '');
      if (COMPANY_NIPS.some(nip => cleanSupplierNip === nip)) {
        hasSupplierError = true;
        const companyName = cleanSupplierNip === '5851490834' ? 'Aura Herbals' : 'firma';
        supplierErrorMessage = `BŁĄD: AI pomyliło strony faktury - ${companyName} (NIP: ${cleanSupplierNip}) to NABYWCA (kupujący), nie SPRZEDAWCA (dostawca). Dane zostały oznaczone jako wymagające korekty.`;
        console.error(supplierErrorMessage);

        // Mark the invalid data with a special prefix so it's easy to spot
        parsedData.supplier_name = `[BŁĄD: TO NABYWCA] ${parsedData.supplier_name || ''}`;
        parsedData.supplier_nip = `[BŁĄD] ${parsedData.supplier_nip}`;
      }
    }

    // Only update fields if OCR found a value OR the field is currently empty
    const updateData: any = {
      status: "draft",
    };

    // Update invoice_number only if OCR found it OR it's currently empty
    if (parsedData.invoice_number) {
      updateData.invoice_number = parsedData.invoice_number;
    } else if (!existingInvoice?.invoice_number) {
      updateData.invoice_number = null;
    }

    // Update supplier_name only if OCR found it OR it's currently empty
    if (parsedData.supplier_name) {
      updateData.supplier_name = parsedData.supplier_name;
    } else if (!existingInvoice?.supplier_name) {
      updateData.supplier_name = null;
    }

    // Update supplier_nip only if OCR found it OR it's currently empty
    if (parsedData.supplier_nip) {
      updateData.supplier_nip = parsedData.supplier_nip;
    } else if (!existingInvoice?.supplier_nip) {
      updateData.supplier_nip = null;
    }

    // Update issue_date only if OCR found it OR it's currently empty
    if (parsedData.issue_date) {
      updateData.issue_date = parsedData.issue_date;
    } else if (!existingInvoice?.issue_date) {
      updateData.issue_date = null;
    }

    // Update due_date only if OCR found it OR it's currently empty
    if (parsedData.due_date) {
      updateData.due_date = parsedData.due_date;
    } else if (!existingInvoice?.due_date) {
      updateData.due_date = null;
    }

    // Update currency only if OCR found it OR it's currently empty
    if (parsedData.currency) {
      updateData.currency = parsedData.currency;
    } else if (!existingInvoice?.currency) {
      updateData.currency = "PLN";
    }

    if (parsedData.net_amount) {
      const netAmount = typeof parsedData.net_amount === 'string'
        ? parseFloat(parsedData.net_amount)
        : parsedData.net_amount;
      if (!isNaN(netAmount) && netAmount > 0) {
        updateData.net_amount = netAmount;
      }
    }

    if (parsedData.tax_amount) {
      const taxAmount = typeof parsedData.tax_amount === 'string'
        ? parseFloat(parsedData.tax_amount)
        : parsedData.tax_amount;
      if (!isNaN(taxAmount) && taxAmount > 0) {
        updateData.tax_amount = taxAmount;
      }
    }

    if (parsedData.gross_amount) {
      const grossAmount = typeof parsedData.gross_amount === 'string'
        ? parseFloat(parsedData.gross_amount)
        : parsedData.gross_amount;
      if (!isNaN(grossAmount) && grossAmount > 0) {
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

    // Get suggested tags based on vendor and description
    console.log("Fetching suggested tags...");
    let suggestedTags = [];
    try {
      const vendorName = updateData.supplier_name?.trim() || '';

      if (vendorName) {
        console.log(`Searching tags for vendor: "${vendorName}"`);

        // First, try to find tags by exact vendor match
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

          // Sort by frequency and take top 3
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
          console.log("No tags found for exact vendor match, checking all vendor tags...");

          // If no exact match, get all tags with their vendors to see what's available
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
            console.log(`Found ${allTags.length} total tag learning entries`);

            // Try case-insensitive and partial match
            const similarTags = allTags.filter(item =>
              item.vendor_name &&
              item.vendor_name.toLowerCase().includes(vendorName.toLowerCase())
            );

            if (similarTags.length > 0) {
              console.log(`✓ Found ${similarTags.length} tags with partial vendor match`);
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
            } else {
              console.log(`No similar vendors found. Available vendors: ${allTags.map(t => t.vendor_name).filter((v, i, a) => a.indexOf(v) === i).join(', ')}`);
            }
          }
        }
      } else {
        console.log("No vendor name available for tag suggestion");
      }

      if (suggestedTags.length > 0) {
        console.log(`✓ Returning ${suggestedTags.length} suggested tags:`, suggestedTags.map(t => t.name));
      } else {
        console.log("No suggested tags found");
      }
    } catch (tagError) {
      console.error("Error fetching suggested tags:", tagError);
    }

    let suggestedDescription: string | null = null;
    try {
      const vendorName = updateData.supplier_name?.trim() || '';
      const supplierNip = updateData.supplier_nip?.trim() || '';

      if (vendorName || supplierNip) {
        console.log("Looking up historical descriptions...");

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
          console.log(`Suggested description from history (${sorted[0][1]}x): "${suggestedDescription}"`);
        } else {
          console.log("No historical descriptions found for this vendor");

          if (vendorName) {
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
                console.log(`Suggested description from keywords: "${suggestedDescription}"`);
              }
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
        const { error: descUpdateError } = await supabase
          .from('invoices')
          .update({ description: suggestedDescription })
          .eq('id', invoiceId);

        if (descUpdateError) {
          console.error("Failed to update description:", descUpdateError);
        } else {
          console.log("Auto-applied description to invoice");
        }
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