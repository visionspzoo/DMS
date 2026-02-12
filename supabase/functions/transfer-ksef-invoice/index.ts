import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface TransferRequest {
  ksefInvoiceId: string;
  departmentId: string;
  userId?: string;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ksefInvoiceId, departmentId, userId }: TransferRequest = await req.json();
    console.log(`🔄 Transfer request:`, { ksefInvoiceId, departmentId, userId });

    // 1. Get KSEF invoice
    const { data: ksefInvoice, error: ksefError } = await supabase
      .from("ksef_invoices")
      .select("*")
      .eq("id", ksefInvoiceId)
      .single();

    if (ksefError) {
      console.error("❌ Error fetching KSEF invoice:", ksefError);
      throw new Error(`KSEF invoice fetch error: ${ksefError.message}`);
    }

    if (!ksefInvoice) {
      console.error("❌ KSEF invoice not found:", ksefInvoiceId);
      throw new Error("KSEF invoice not found");
    }

    console.log(`✓ Found KSEF invoice: ${ksefInvoice.invoice_number}`);

    // 2. Get department info
    const { data: department, error: deptError } = await supabase
      .from("departments")
      .select("name, google_drive_draft_folder_id")
      .eq("id", departmentId)
      .single();

    if (deptError) {
      console.error("❌ Error fetching department:", deptError);
      throw new Error(`Department fetch error: ${deptError.message}`);
    }

    if (!department) {
      console.error("❌ Department not found:", departmentId);
      throw new Error("Department not found");
    }

    console.log(`✓ Found department: ${department.name}`);

    // 3. Get or generate PDF - use same strategy as KSEFInvoiceModal
    let pdfBase64: string;
    let xmlContent = ksefInvoice.xml_content || ksefInvoice.invoice_xml;

    console.log(`📥 Getting PDF for ${ksefInvoice.ksef_reference_number}...`);
    console.log(`   Has existing XML in DB: ${!!xmlContent}`);

    // Strategy 0: If no XML in DB, try to fetch it from KSEF first
    if (!xmlContent) {
      console.log("Strategy 0: Fetching XML from KSEF API (not in DB)...");
      try {
        const ksefProxyUrl = `${supabaseUrl}/functions/v1/ksef-proxy`;
        const xmlParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefInvoice.ksef_reference_number)}/xml`,
        });

        const xmlResponse = await fetch(`${ksefProxyUrl}?${xmlParams}`, {
          method: "GET",
          headers: {
            "Authorization": req.headers.get("Authorization") || "",
          },
        });

        if (xmlResponse.ok) {
          xmlContent = await xmlResponse.text();
          console.log(`✓ XML fetched from KSEF (${xmlContent.length} chars)`);

          // Save XML to database for future use
          try {
            await supabase
              .from("ksef_invoices")
              .update({ xml_content: xmlContent })
              .eq("id", ksefInvoice.id);
            console.log("✓ XML saved to database");
          } catch (saveError) {
            console.warn("Failed to save XML to DB (non-critical):", saveError);
          }
        } else {
          const errorText = await xmlResponse.text();
          console.warn(`Strategy 0 failed: ${xmlResponse.status} - ${errorText}`);
        }
      } catch (xmlError: any) {
        console.warn("Strategy 0 error:", xmlError.message);
      }
    }

    if (xmlContent) {
      console.log(`   XML length: ${xmlContent.length} characters`);
      console.log(`   XML preview (first 200 chars): ${xmlContent.substring(0, 200)}`);
    }

    // Strategy 1: Generate PDF from XML (most reliable)
    if (xmlContent) {
      console.log("Strategy 1: Generating PDF from existing XML...");
      try {
        const generateResponse = await fetch(
          `${supabaseUrl}/functions/v1/generate-ksef-pdf`,
          {
            method: "POST",
            headers: {
              "Authorization": req.headers.get("Authorization") || "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              xml: xmlContent,
              ksefNumber: ksefInvoice.ksef_reference_number,
            }),
          }
        );

        console.log(`   Generate PDF response status: ${generateResponse.status}`);
        console.log(`   Generate PDF response headers:`, Object.fromEntries(generateResponse.headers.entries()));

        if (generateResponse.ok) {
          const contentType = generateResponse.headers.get("content-type");
          console.log(`   Response content-type: ${contentType}`);

          const pdfBlob = await generateResponse.blob();
          console.log(`   PDF blob size: ${pdfBlob.size} bytes`);
          console.log(`   PDF blob type: ${pdfBlob.type}`);

          const pdfArrayBuffer = await pdfBlob.arrayBuffer();
          pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          console.log(`✓ PDF generated from XML successfully (${pdfBlob.size} bytes)`);
        } else {
          const errorText = await generateResponse.text();
          console.error(`❌ Strategy 1 failed with status ${generateResponse.status}`);
          console.error(`   Error response: ${errorText}`);
          throw new Error(`PDF generation from XML failed: ${errorText}`);
        }
      } catch (genError: any) {
        console.error("❌ Strategy 1 error:", genError);
        console.error("   Error message:", genError.message);
        console.error("   Error stack:", genError.stack);
        // Continue to Strategy 2
        pdfBase64 = null as any;
      }
    } else {
      console.warn("⚠️  No XML content available, skipping Strategy 1");
    }

    // Strategy 2: Download PDF from KSEF API (fallback)
    if (!pdfBase64) {
      console.log("Strategy 2: Downloading PDF from KSEF API...");
      const ksefProxyUrl = `${supabaseUrl}/functions/v1/ksef-proxy`;
      const pdfParams = new URLSearchParams({
        path: `/api/external/invoices/${encodeURIComponent(ksefInvoice.ksef_reference_number)}/pdf`,
      });

      const pdfResponse = await fetch(`${ksefProxyUrl}?${pdfParams}`, {
        method: "GET",
        headers: {
          "Authorization": req.headers.get("Authorization") || "",
        },
      });

      if (!pdfResponse.ok) {
        const errorText = await pdfResponse.text();
        console.error(`❌ Strategy 2 failed: ${pdfResponse.status}`);
        console.error(`   Response:`, errorText);
        throw new Error(`Cannot get PDF - both XML generation and KSEF download failed`);
      }

      const pdfBlob = await pdfResponse.blob();
      const pdfArrayBuffer = await pdfBlob.arrayBuffer();
      pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
      console.log(`✓ PDF downloaded from KSEF API successfully (${pdfBlob.size} bytes)`);
    }

    // 4. Try to download XML if we don't have it yet (non-blocking)
    if (!xmlContent) {
      console.log("Attempting to download XML from KSEF (non-blocking)...");
      try {
        const ksefProxyUrl = `${supabaseUrl}/functions/v1/ksef-proxy`;
        const xmlParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefInvoice.ksef_reference_number)}/xml`,
        });

        const xmlResponse = await fetch(`${ksefProxyUrl}?${xmlParams}`, {
          method: "GET",
          headers: {
            "Authorization": req.headers.get("Authorization") || "",
          },
        });

        if (xmlResponse.ok) {
          xmlContent = await xmlResponse.text();
          console.log("✓ Downloaded XML from KSEF");
        } else {
          console.warn("Failed to download XML (non-blocking)");
        }
      } catch (xmlError) {
        console.error("XML download error (non-blocking):", xmlError);
      }
    }

    // 5. Upload PDF to Google Drive (if configured)
    let driveFileUrl = null;
    let googleDriveId = null;

    if (department.google_drive_draft_folder_id && ksefInvoice.fetched_by) {
      const uploadResponse = await fetch(
        `${supabaseUrl}/functions/v1/upload-to-google-drive`,
        {
          method: "POST",
          headers: {
            "Authorization": req.headers.get("Authorization") || "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileName: `${ksefInvoice.invoice_number}.pdf`,
            fileBase64: pdfBase64,
            folderId: department.google_drive_draft_folder_id,
            mimeType: "application/pdf",
            userId: ksefInvoice.fetched_by, // Pass userId directly to avoid token validation
          }),
        }
      );

      if (uploadResponse.ok) {
        const uploadResult = await uploadResponse.json();
        googleDriveId = uploadResult.fileId;
        driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;
      } else {
        console.warn("Failed to upload to Google Drive, will store PDF in database only");
      }
    }

    // 6. Get exchange rate if needed
    let exchangeRate = 1;
    let plnGrossAmount = ksefInvoice.gross_amount;

    if (ksefInvoice.currency !== "PLN" && ksefInvoice.issue_date) {
      try {
        const rateResponse = await fetch(
          `${supabaseUrl}/functions/v1/get-exchange-rate`,
          {
            method: "POST",
            headers: {
              "Authorization": req.headers.get("Authorization") || "",
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              currency: ksefInvoice.currency,
              date: ksefInvoice.issue_date,
            }),
          }
        );

        if (rateResponse.ok) {
          const rateData = await rateResponse.json();
          exchangeRate = rateData.rate;
          plnGrossAmount = ksefInvoice.gross_amount * exchangeRate;
        }
      } catch (err) {
        console.error("Error fetching exchange rate:", err);
      }
    }

    // 7. Get auth user ID from JWT (optional, fallback to fetched_by)
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let uploaderId = null;

    if (token) {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        uploaderId = user?.id;
      } catch (error) {
        console.warn("Could not extract user from token, will use fetched_by instead");
      }
    }

    // 8. Create invoice record
    const taxAmount = ksefInvoice.tax_amount || (ksefInvoice.gross_amount - ksefInvoice.net_amount);

    const invoiceData: any = {
      invoice_number: ksefInvoice.invoice_number,
      supplier_name: ksefInvoice.supplier_name || "Brak nazwy",
      supplier_nip: ksefInvoice.supplier_nip,
      gross_amount: ksefInvoice.gross_amount,
      net_amount: ksefInvoice.net_amount,
      tax_amount: taxAmount,
      currency: ksefInvoice.currency,
      issue_date: ksefInvoice.issue_date,
      status: "draft",
      uploaded_by: uploaderId || ksefInvoice.fetched_by,
      department_id: departmentId,
      file_url: driveFileUrl,
      pdf_base64: pdfBase64,
      description: "Faktura z KSEF - dodana jako wersja robocza",
      pln_gross_amount: plnGrossAmount,
      exchange_rate: exchangeRate,
      source: "ksef",
      google_drive_id: googleDriveId,
    };

    if (userId) {
      invoiceData.current_approver_id = userId;
    }

    const { data: newInvoice, error: insertError } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single();

    if (insertError) {
      throw insertError;
    }

    // 9. Update KSEF invoice record with XML
    const updateData: any = {
      transferred_to_invoice_id: newInvoice.id,
      transferred_to_department_id: departmentId,
      transferred_at: new Date().toISOString(),
      assigned_to_department_at: new Date().toISOString(),
    };

    if (xmlContent) {
      updateData.xml_content = xmlContent;
    }

    const { error: updateError } = await supabase
      .from("ksef_invoices")
      .update(updateData)
      .eq("id", ksefInvoiceId);

    if (updateError) {
      throw updateError;
    }

    // 10. Run OCR on the transferred invoice (only if uploaded to Google Drive)
    if (driveFileUrl) {
      try {
        await fetch(`${supabaseUrl}/functions/v1/process-invoice-ocr`, {
          method: "POST",
          headers: {
            "Authorization": req.headers.get("Authorization") || "",
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            fileUrl: driveFileUrl,
            invoiceId: newInvoice.id,
          }),
        });
      } catch (ocrError) {
        console.error("OCR error (non-blocking):", ocrError);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        invoice: newInvoice,
        message: "Faktura została przeniesiona pomyślnie",
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Transfer error:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Nie udało się przenieść faktury",
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
