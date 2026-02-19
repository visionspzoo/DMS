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
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const { ksefInvoiceId, departmentId, userId }: TransferRequest = await req.json();
    console.log(`🔄 Transfer request:`, { ksefInvoiceId, departmentId, userId });

    // Get auth user ID from JWT early (needed for various operations)
    const authHeader = req.headers.get("Authorization");
    const token = authHeader?.replace("Bearer ", "");
    let uploaderId = null;

    if (token) {
      try {
        const { data: { user } } = await supabase.auth.getUser(token);
        uploaderId = user?.id;
        console.log(`✓ Authenticated user ID: ${uploaderId}`);
      } catch (error) {
        console.warn("Could not extract user from token, will use fetched_by instead");
      }
    }

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

    // 3. Get PDF - use existing from database, or try to download if not available
    let pdfBase64 = ksefInvoice.pdf_base64;

    if (!pdfBase64) {
      console.log("No PDF in database, attempting download from KSEF...");
      try {
        const ksefProxyUrl = `${supabaseUrl}/functions/v1/ksef-proxy`;
        const pdfParams = new URLSearchParams({
          path: `/api/external/invoices/${encodeURIComponent(ksefInvoice.ksef_reference_number)}/pdf-base64`,
        });

        const pdfResponse = await fetch(`${ksefProxyUrl}?${pdfParams}`, {
          method: "GET",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json",
          },
        });

        if (pdfResponse.ok) {
          const pdfData = await pdfResponse.json();
          if (pdfData.success && pdfData.data?.base64) {
            pdfBase64 = pdfData.data.base64;
            const sizeBytes = pdfData.data.sizeBytes || "unknown";
            console.log(`PDF downloaded from KSEF (${sizeBytes} bytes)`);

            await supabase
              .from("ksef_invoices")
              .update({ pdf_base64: pdfBase64 })
              .eq("id", ksefInvoice.id);
          } else {
            console.warn("Invalid PDF response format, trying XML generation");
          }
        } else {
          console.warn(`PDF download failed (${pdfResponse.status}), trying XML generation`);
        }
      } catch (pdfError: any) {
        console.warn("PDF download failed, trying XML generation:", pdfError.message);
      }
    } else {
      console.log(`Using existing PDF from database`);
    }

    // 4. If still no PDF, try generating from XML content
    if (!pdfBase64 && ksefInvoice.xml_content) {
      console.log("Generating PDF from XML content...");
      try {
        const genResponse = await fetch(
          `${supabaseUrl}/functions/v1/generate-ksef-pdf`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              xml: ksefInvoice.xml_content,
              ksefNumber: ksefInvoice.ksef_reference_number,
            }),
          }
        );

        if (genResponse.ok) {
          const pdfArrayBuffer = await genResponse.arrayBuffer();
          pdfBase64 = btoa(String.fromCharCode(...new Uint8Array(pdfArrayBuffer)));
          console.log(`PDF generated from XML (${pdfArrayBuffer.byteLength} bytes)`);

          await supabase
            .from("ksef_invoices")
            .update({ pdf_base64: pdfBase64 })
            .eq("id", ksefInvoice.id);
        } else {
          console.warn(`PDF generation from XML failed (${genResponse.status})`);
        }
      } catch (genError: any) {
        console.warn("PDF generation from XML failed:", genError.message);
      }
    }

    // 5. Upload PDF to Google Drive (ZAWSZE gdy PDF jest dostępny i folder skonfigurowany)
    let driveFileUrl = null;
    let googleDriveId = null;

    if (pdfBase64 && department.google_drive_draft_folder_id) {
      try {
        console.log("📤 Uploading PDF to Google Drive...");
        console.log(`Folder: ${department.google_drive_draft_folder_id}`);
        console.log(`File: ${ksefInvoice.invoice_number}.pdf`);

        // Use fetched_by as userId, or fallback to uploaderId
        const userIdForUpload = ksefInvoice.fetched_by || uploaderId;

        if (!userIdForUpload) {
          console.warn("⚠️ No user ID available for Google Drive upload, skipping...");
        } else {
          const uploadResponse = await fetch(
            `${supabaseUrl}/functions/v1/upload-to-google-drive`,
            {
              method: "POST",
              headers: {
                "Authorization": `Bearer ${supabaseAnonKey}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fileName: `${ksefInvoice.invoice_number}.pdf`,
                fileBase64: pdfBase64,
                folderId: department.google_drive_draft_folder_id,
                mimeType: "application/pdf",
                userId: userIdForUpload,
              }),
            }
          );

          if (uploadResponse.ok) {
            const uploadResult = await uploadResponse.json();
            googleDriveId = uploadResult.fileId;
            driveFileUrl = `https://drive.google.com/file/d/${uploadResult.fileId}/view`;
            console.log(`✓ PDF uploaded to Google Drive: ${driveFileUrl}`);
          } else {
            const errorText = await uploadResponse.text();
            console.error(`❌ Failed to upload to Google Drive: ${errorText}`);
            console.warn("Will store PDF in database only");
          }
        }
      } catch (uploadError: any) {
        console.error("❌ Error during Google Drive upload:", uploadError.message);
        console.warn("Will store PDF in database only");
      }
    } else {
      if (!pdfBase64) {
        console.log("⚠️ Skipping Google Drive upload - no PDF available");
      } else if (!department.google_drive_draft_folder_id) {
        console.log("⚠️ Skipping Google Drive upload - no Google Drive folder configured for department");
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
              "Authorization": `Bearer ${supabaseAnonKey}`,
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

    // 7. Find appropriate approver for department if userId not provided
    let appropriateApproverId = userId || null;

    if (!appropriateApproverId) {
      console.log("👤 Finding appropriate approver for department...");
      try {
        const { data: approverData, error: approverError } = await supabase
          .rpc("get_next_approver_in_department", {
            dept_id: departmentId,
            user_role: null,
          });

        if (approverError) {
          console.error("⚠️ Error finding approver:", approverError);
        } else if (approverData) {
          appropriateApproverId = approverData;
          console.log("✓ Found appropriate approver:", appropriateApproverId);
        } else {
          console.warn("⚠️ No approver found for department");
        }
      } catch (err) {
        console.error("⚠️ Error calling get_next_approver_in_department:", err);
      }
    }

    // 8. Create invoice record
    const taxAmount = ksefInvoice.tax_amount || (ksefInvoice.gross_amount - ksefInvoice.net_amount);

    // The invoice owner is the selected user (or auto-detected manager), not the admin doing the transfer
    const invoiceOwner = appropriateApproverId || uploaderId || ksefInvoice.fetched_by;

    const invoiceData: any = {
      invoice_number: ksefInvoice.invoice_number,
      supplier_name: ksefInvoice.supplier_name || "Brak nazwy",
      supplier_nip: ksefInvoice.supplier_nip,
      buyer_name: ksefInvoice.buyer_name || null,
      buyer_nip: ksefInvoice.buyer_nip || null,
      gross_amount: ksefInvoice.gross_amount,
      net_amount: ksefInvoice.net_amount,
      tax_amount: taxAmount,
      currency: ksefInvoice.currency,
      issue_date: ksefInvoice.issue_date,
      status: "draft",
      uploaded_by: invoiceOwner,
      department_id: departmentId,
      file_url: driveFileUrl,
      pdf_base64: pdfBase64,
      description: "Faktura z KSEF - dodana jako wersja robocza",
      pln_gross_amount: plnGrossAmount,
      exchange_rate: exchangeRate,
      source: "ksef",
      google_drive_id: googleDriveId,
      current_approver_id: appropriateApproverId,
    };

    console.log(`📝 Creating invoice with data:`, {
      uploaded_by: invoiceData.uploaded_by,
      department_id: invoiceData.department_id,
      invoice_number: invoiceData.invoice_number,
      status: invoiceData.status
    });

    const { data: newInvoice, error: insertError } = await supabase
      .from("invoices")
      .insert(invoiceData)
      .select()
      .single();

    if (insertError) {
      console.error('❌ Invoice insert error:', insertError);
      throw insertError;
    }

    console.log(`✓ Invoice created successfully with ID: ${newInvoice.id}`);

    // 9. Update KSEF invoice record
    const updateData: any = {
      transferred_to_invoice_id: newInvoice.id,
      transferred_to_department_id: departmentId,
      transferred_at: new Date().toISOString(),
      assigned_to_department_at: new Date().toISOString(),
    };

    if (ksefInvoice.xml_content) {
      updateData.xml_content = ksefInvoice.xml_content;
    }

    // Save PDF base64 to ksef_invoices for preview
    if (pdfBase64) {
      updateData.pdf_base64 = pdfBase64;
    }

    const { error: updateError } = await supabase
      .from("ksef_invoices")
      .update(updateData)
      .eq("id", ksefInvoiceId);

    if (updateError) {
      throw updateError;
    }

    // 10. Run OCR on the transferred invoice (only if PDF is available)
    if (pdfBase64) {
      try {
        console.log("🔍 === URUCHAMIANIE OCR DLA FAKTURY KSEF ===");
        const ocrResponse = await fetch(`${supabaseUrl}/functions/v1/process-invoice-ocr`, {
          method: "POST",
          headers: {
            "Authorization": `Bearer ${supabaseAnonKey}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            pdfBase64: pdfBase64,
            invoiceId: newInvoice.id,
          }),
        });

        if (ocrResponse.ok) {
          console.log("✓ OCR zakończone pomyślnie");
        } else {
          const ocrError = await ocrResponse.json();
          console.error("❌ OCR nie powiodło się:", ocrError);
        }
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
