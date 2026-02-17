import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface ReprocessRequest {
  invoiceIds: string[];
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    console.log("=== BATCH REPROCESS STARTED ===");

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw new Error("Supabase configuration missing");
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const { invoiceIds }: ReprocessRequest = await req.json();

    if (!invoiceIds || invoiceIds.length === 0) {
      throw new Error("No invoice IDs provided");
    }

    console.log(`Processing ${invoiceIds.length} invoices...`);

    const results = [];

    for (const invoiceId of invoiceIds) {
      console.log(`\n--- Processing invoice ${invoiceId} ---`);

      try {
        // Pobierz dane faktury
        const { data: invoice, error: fetchError } = await supabase
          .from('invoices')
          .select('id, invoice_number, pdf_base64, file_url')
          .eq('id', invoiceId)
          .maybeSingle();

        if (fetchError || !invoice) {
          console.error(`Invoice ${invoiceId} not found:`, fetchError);
          results.push({
            invoiceId,
            success: false,
            error: "Invoice not found",
          });
          continue;
        }

        console.log(`Found invoice: ${invoice.invoice_number}`);

        // Przygotuj request do OCR
        const requestBody: any = {
          invoiceId: invoice.id,
        };

        if (invoice.pdf_base64) {
          requestBody.pdfBase64 = invoice.pdf_base64;
          console.log("Using pdf_base64 for OCR");
        } else if (invoice.file_url) {
          requestBody.fileUrl = invoice.file_url;
          console.log("Using file_url for OCR");
        } else {
          console.error("No PDF data available");
          results.push({
            invoiceId,
            invoiceNumber: invoice.invoice_number,
            success: false,
            error: "No PDF data available",
          });
          continue;
        }

        // Wywołaj OCR jako internal service call
        console.log("Calling process-invoice-ocr...");
        const ocrResponse = await fetch(
          `${supabaseUrl}/functions/v1/process-invoice-ocr`,
          {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${supabaseServiceKey}`,
              'Content-Type': 'application/json',
              'x-region': 'us-east-1',
            },
            body: JSON.stringify(requestBody),
          }
        );

        if (!ocrResponse.ok) {
          const errorText = await ocrResponse.text();
          console.error(`OCR failed: ${errorText}`);
          results.push({
            invoiceId,
            invoiceNumber: invoice.invoice_number,
            success: false,
            error: `OCR failed: ${errorText}`,
          });
          continue;
        }

        const ocrData = await ocrResponse.json();
        console.log(`✓ OCR successful for ${invoice.invoice_number}`);

        results.push({
          invoiceId,
          invoiceNumber: invoice.invoice_number,
          success: true,
          data: ocrData,
        });

      } catch (error) {
        console.error(`Error processing invoice ${invoiceId}:`, error);
        results.push({
          invoiceId,
          success: false,
          error: error.message || error.toString(),
        });
      }
    }

    console.log("=== BATCH REPROCESS COMPLETED ===");
    console.log(`Successful: ${results.filter(r => r.success).length}/${results.length}`);

    return new Response(
      JSON.stringify({
        success: true,
        results,
        summary: {
          total: results.length,
          successful: results.filter(r => r.success).length,
          failed: results.filter(r => !r.success).length,
        },
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error) {
    console.error("=== BATCH REPROCESS FAILED ===");
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
