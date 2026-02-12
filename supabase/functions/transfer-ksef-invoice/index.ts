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

    // 1. Get KSEF invoice
    const { data: ksefInvoice, error: ksefError } = await supabase
      .from("ksef_invoices")
      .select("*")
      .eq("id", ksefInvoiceId)
      .single();

    if (ksefError || !ksefInvoice) {
      throw new Error("KSEF invoice not found");
    }

    // 2. Get department info
    const { data: department, error: deptError } = await supabase
      .from("departments")
      .select("name, google_drive_draft_folder_id")
      .eq("id", departmentId)
      .single();

    if (deptError || !department) {
      throw new Error("Department not found");
    }

    // 3. Download PDF from KSEF API
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
      throw new Error("Failed to download PDF from KSEF");
    }

    const pdfBlob = await pdfResponse.blob();
    const pdfArrayBuffer = await pdfBlob.arrayBuffer();
    const pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));

    // 4. Download XML from KSEF API
    let xmlContent = null;
    try {
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

    // 5. Upload PDF to Google Drive (if configured)
    let driveFileUrl = null;
    let googleDriveId = null;

    if (department.google_drive_draft_folder_id) {
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

    // 7. Get auth user ID from JWT
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let uploaderId = null;

    if (token) {
      const { data: { user } } = await supabase.auth.getUser(token);
      uploaderId = user?.id;
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
      transferred_at: new Date().toISOString(),
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
