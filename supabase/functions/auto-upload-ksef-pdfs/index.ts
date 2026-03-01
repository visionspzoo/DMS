import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    // Check if specific invoice ID was provided
    let invoiceIdFilter: string | null = null;
    try {
      const body = await req.json();
      invoiceIdFilter = body.invoiceId || null;
    } catch {
      // No body or invalid JSON, process all invoices
    }

    if (invoiceIdFilter) {
      console.log(`🔍 Processing specific invoice: ${invoiceIdFilter}`);
    } else {
      console.log("🔍 Searching for all invoices with PDF but without Google Drive ID...");
    }

    // Build query
    let query = supabase
      .from("invoices")
      .select(`
        id,
        invoice_number,
        issue_date,
        pdf_base64,
        department_id,
        uploaded_by,
        departments:department_id (
          google_drive_draft_folder_id
        )
      `)
      .eq("source", "ksef")
      .is("google_drive_id", null)
      .not("pdf_base64", "is", null)
      .not("department_id", "is", null);

    // Add invoice ID filter if provided
    if (invoiceIdFilter) {
      query = query.eq("id", invoiceIdFilter);
    }

    const { data: invoices, error: fetchError } = await query;

    if (fetchError) {
      console.error("❌ Error fetching invoices:", fetchError);
      throw fetchError;
    }

    if (!invoices || invoices.length === 0) {
      console.log("✓ No invoices found that need PDF upload");
      return new Response(
        JSON.stringify({
          success: true,
          message: "No invoices to process",
          processed: 0,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    console.log(`📄 Found ${invoices.length} invoices to process`);

    let successCount = 0;
    let failCount = 0;
    const errors: Array<{ invoiceId: string; error: string }> = [];

    for (const invoice of invoices) {
      try {
        const department = invoice.departments as any;

        if (!department?.google_drive_draft_folder_id) {
          console.log(`⚠️ Skipping invoice ${invoice.invoice_number} - no Google Drive folder configured`);
          continue;
        }

        if (!invoice.uploaded_by) {
          console.log(`⚠️ Skipping invoice ${invoice.invoice_number} - no uploader user ID`);
          continue;
        }

        console.log(`📤 Uploading PDF for invoice ${invoice.invoice_number}...`);

        const uploadResponse = await fetch(
          `${supabaseUrl}/functions/v1/upload-to-google-drive`,
          {
            method: "POST",
            headers: {
              "Authorization": `Bearer ${supabaseAnonKey}`,
              "Content-Type": "application/json",
            },
            body: JSON.stringify({
              fileName: `${invoice.invoice_number}.pdf`,
              fileBase64: invoice.pdf_base64,
              folderId: department.google_drive_draft_folder_id,
              mimeType: "application/pdf",
              userId: invoice.uploaded_by,
              issueDate: invoice.issue_date || null,
            }),
          }
        );

        if (uploadResponse.ok) {
          const uploadResult = await uploadResponse.json();
          const googleDriveId = uploadResult.fileId;

          // Update invoice with Google Drive ID
          const { error: updateError } = await supabase
            .from("invoices")
            .update({
              google_drive_id: googleDriveId,
              user_drive_file_id: googleDriveId,
              file_url: `https://drive.google.com/file/d/${googleDriveId}/view`,
            })
            .eq("id", invoice.id);

          if (updateError) {
            console.error(`❌ Error updating invoice ${invoice.invoice_number}:`, updateError);
            failCount++;
            errors.push({
              invoiceId: invoice.id,
              error: `Failed to update database: ${updateError.message}`,
            });
          } else {
            console.log(`✓ Successfully uploaded PDF for invoice ${invoice.invoice_number}`);
            successCount++;
          }
        } else {
          const errorText = await uploadResponse.text();
          console.error(`❌ Failed to upload PDF for invoice ${invoice.invoice_number}:`, errorText);
          failCount++;
          errors.push({
            invoiceId: invoice.id,
            error: `Upload failed: ${errorText}`,
          });
        }
      } catch (err: any) {
        console.error(`❌ Error processing invoice ${invoice.invoice_number}:`, err);
        failCount++;
        errors.push({
          invoiceId: invoice.id,
          error: err.message || "Unknown error",
        });
      }
    }

    console.log(`✅ Processed ${successCount + failCount} invoices: ${successCount} success, ${failCount} failed`);

    return new Response(
      JSON.stringify({
        success: true,
        processed: successCount + failCount,
        successCount,
        failCount,
        errors: errors.length > 0 ? errors : undefined,
      }),
      {
        headers: {
          ...corsHeaders,
          "Content-Type": "application/json",
        },
      }
    );
  } catch (error: any) {
    console.error("Error in auto-upload-ksef-pdfs:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Failed to process invoices",
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
