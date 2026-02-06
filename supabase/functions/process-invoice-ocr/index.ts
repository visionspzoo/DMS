import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";
import pdfParse from "npm:pdf-parse@1.1.1";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface OCRRequest {
  fileUrl: string;
  invoiceId: string;
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
  "supplier_name": "nazwa SPRZEDAWCY/dostawcy lub null",
  "supplier_nip": "numer identyfikacji podatkowej SPRZEDAWCY (NIP/VAT ID/Tax ID) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "kwota netto jako string z kropką np. 1234.56",
  "tax_amount": "kwota VAT jako string z kropką",
  "gross_amount": "kwota brutto jako string z kropką",
  "currency": "kod waluty: PLN, EUR, USD, GBP itp."
}

UWAGI:
- supplier to SPRZEDAWCA (nie nabywca!)
- Akceptuj faktury w dowolnej walucie (PLN, EUR, USD, GBP itp.)
- Dla faktur zagranicznych: znajdź VAT ID, Tax ID, lub lokalny numer podatkowy
- Daty w formacie YYYY-MM-DD
- Kwoty jako stringi z kropką (nie przecinkiem)
- Walutę zapisz jako 3-literowy kod ISO (np. EUR, USD, PLN)
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
  "supplier_name": "nazwa SPRZEDAWCY lub null",
  "supplier_nip": "numer identyfikacji podatkowej SPRZEDAWCY (NIP/VAT ID/Tax ID) lub null",
  "issue_date": "YYYY-MM-DD lub null",
  "due_date": "YYYY-MM-DD lub null",
  "net_amount": "string z kropką",
  "tax_amount": "string z kropką",
  "gross_amount": "string z kropką",
  "currency": "kod waluty (PLN/EUR/USD/GBP itp.)"
}

UWAGI:
- Akceptuj faktury w dowolnej walucie
- Dla faktur zagranicznych: znajdź VAT ID, Tax ID, lub lokalny numer podatkowy
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
    const { fileUrl, invoiceId }: OCRRequest = await req.json();

    console.log("Processing invoice:", { fileUrl, invoiceId });

    let content: string;
    let usedApi: string;
    let errorDetails: any = null;

    if (!claudeApiKey && !mistralApiKey) {
      console.log("No API keys configured - using fallback");
      const fallback = createFallbackInterpretation();
      content = JSON.stringify(fallback);
      usedApi = "Fallback (no AI keys)";
    } else {
      console.log("Fetching file from URL...");
      const fileResponse = await fetch(fileUrl);
      if (!fileResponse.ok) {
        throw new Error(`Failed to fetch file: ${fileResponse.status}`);
      }

      const fileBlob = await fileResponse.blob();
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
          .eq('vendor_name', vendorName);

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

    console.log("=== OCR PROCESSING COMPLETED ===");

    return new Response(
      JSON.stringify({
        success: true,
        data: parsedData,
        usedApi,
        error: errorDetails,
        suggestedTags,
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