import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Brak nagłówka autoryzacji" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const supabase = createClient(supabaseUrl, supabaseServiceKey);
    const userClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: authHeader } },
    });

    const { data: { user }, error: userError } = await userClient.auth.getUser();
    if (userError || !user) {
      return new Response(
        JSON.stringify({ success: false, error: "Nieautoryzowany" }),
        { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const body = await req.json().catch(() => ({}));
    const isStream = body.stream === true;

    const { data: profile } = await supabase
      .from("profiles")
      .select("is_admin, role")
      .eq("id", user.id)
      .maybeSingle();

    const isAdmin = profile?.is_admin === true;

    let invoicesQuery = supabase
      .from("invoices")
      .select("id, file_url, file_name, invoice_number, department_id, status, issue_date, pdf_base64, source, uploaded_by")
      .is("google_drive_id", null)
      .not("status", "eq", "draft")
      .not("file_url", "is", null);

    if (!isAdmin) {
      invoicesQuery = invoicesQuery.eq("uploaded_by", user.id);
    }

    if (body.source) {
      invoicesQuery = invoicesQuery.eq("source", body.source);
    } else {
      invoicesQuery = invoicesQuery.in("source", ["email", "drive", "manual"]);
    }

    if (body.invoice_ids && Array.isArray(body.invoice_ids) && body.invoice_ids.length > 0) {
      invoicesQuery = invoicesQuery.in("id", body.invoice_ids);
    }

    const { data: invoices, error: invoicesError } = await invoicesQuery.limit(200);

    if (invoicesError) {
      return new Response(
        JSON.stringify({ success: false, error: invoicesError.message }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!invoices || invoices.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Brak faktur do przesłania na Drive", uploaded: 0, failed: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (isStream) {
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const encoder = new TextEncoder();

      const send = async (data: object) => {
        await writer.write(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      EdgeRuntime.waitUntil((async () => {
        try {
          await send({ type: "start", total: invoices.length });

          let uploaded = 0;
          let failed = 0;
          let skipped = 0;

          for (let i = 0; i < invoices.length; i++) {
            const invoice = invoices[i];
            await send({ type: "progress", current: i + 1, total: invoices.length, invoice_id: invoice.id });

            const result = await uploadInvoiceToDrive(supabase, invoice, user.id);

            if (result.success) {
              uploaded++;
              await send({ type: "uploaded", invoice_id: invoice.id, file_id: result.fileId });
            } else if (result.skipped) {
              skipped++;
              await send({ type: "skipped", invoice_id: invoice.id, reason: result.reason });
            } else {
              failed++;
              await send({ type: "failed", invoice_id: invoice.id, error: result.error });
            }
          }

          await send({ type: "done", uploaded, failed, skipped });
        } catch (err: any) {
          await send({ type: "error", error: err.message });
        } finally {
          await writer.close();
        }
      })());

      return new Response(stream.readable, {
        headers: {
          ...corsHeaders,
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
        },
      });
    }

    let uploaded = 0;
    let failed = 0;
    let skipped = 0;
    const errors: string[] = [];

    for (const invoice of invoices) {
      const result = await uploadInvoiceToDrive(supabase, invoice, user.id);
      if (result.success) {
        uploaded++;
      } else if (result.skipped) {
        skipped++;
      } else {
        failed++;
        errors.push(`${invoice.invoice_number || invoice.id}: ${result.error}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        total: invoices.length,
        uploaded,
        failed,
        skipped,
        errors: errors.length > 0 ? errors : undefined,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in retry-drive-upload:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

async function uploadInvoiceToDrive(
  supabase: any,
  invoice: any,
  requestingUserId: string
): Promise<{ success: boolean; fileId?: string; skipped?: boolean; reason?: string; error?: string }> {
  try {
    const uploaderUserId = invoice.uploaded_by || requestingUserId;
    const deptId = invoice.department_id;

    let targetFolderId: string | null = null;

    if (deptId) {
      const { data: deptInfo } = await supabase
        .from("departments")
        .select("name, google_drive_draft_folder_id, google_drive_unpaid_folder_id, google_drive_paid_folder_id")
        .eq("id", deptId)
        .maybeSingle();

      if (deptInfo) {
        if (invoice.status === "paid") {
          targetFolderId = deptInfo.google_drive_paid_folder_id || deptInfo.google_drive_unpaid_folder_id || deptInfo.google_drive_draft_folder_id;
        } else if (invoice.status === "accepted") {
          targetFolderId = deptInfo.google_drive_unpaid_folder_id || deptInfo.google_drive_draft_folder_id;
        } else {
          targetFolderId = deptInfo.google_drive_draft_folder_id;
        }
      }

      if (!targetFolderId) {
        const { data: deptMapping } = await supabase
          .from("user_drive_folder_mappings")
          .select("google_drive_folder_id, google_drive_folder_url")
          .eq("user_id", uploaderUserId)
          .eq("department_id", deptId)
          .eq("is_active", true)
          .maybeSingle();

        if (deptMapping?.google_drive_folder_id) {
          targetFolderId = deptMapping.google_drive_folder_id;
        } else if (deptMapping?.google_drive_folder_url) {
          const urlMatch = deptMapping.google_drive_folder_url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
          if (urlMatch) targetFolderId = urlMatch[1];
        }
      }
    }

    if (!targetFolderId) {
      const { data: userDriveConfig } = await supabase
        .from("user_drive_configs")
        .select("google_drive_folder_id, google_drive_folder_url")
        .eq("user_id", uploaderUserId)
        .eq("is_active", true)
        .maybeSingle();

      if (userDriveConfig?.google_drive_folder_id) {
        targetFolderId = userDriveConfig.google_drive_folder_id;
      } else if (userDriveConfig?.google_drive_folder_url) {
        const urlMatch = userDriveConfig.google_drive_folder_url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
        if (urlMatch) targetFolderId = urlMatch[1];
      }
    }

    if (!targetFolderId) {
      return { success: false, skipped: true, reason: "Brak skonfigurowanego folderu Drive dla tego użytkownika/działu" };
    }

    const fileName = invoice.invoice_number
      ? `${invoice.invoice_number.replace(/\//g, "_")}.pdf`
      : invoice.file_name || `faktura_${invoice.id}.pdf`;

    const uploadPayload: any = {
      fileName,
      folderId: targetFolderId,
      mimeType: "application/pdf",
      originalMimeType: "application/pdf",
      userId: uploaderUserId,
      invoiceId: invoice.id,
    };

    if (invoice.pdf_base64) {
      uploadPayload.fileBase64 = invoice.pdf_base64;
    } else if (invoice.file_url) {
      uploadPayload.fileUrl = invoice.file_url;
    } else {
      return { success: false, skipped: true, reason: "Brak pliku PDF do przesłania" };
    }

    if (invoice.issue_date) {
      uploadPayload.issueDate = invoice.issue_date;
    }

    const uploadResp = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/upload-to-google-drive`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(uploadPayload),
      }
    );

    if (!uploadResp.ok) {
      const errText = await uploadResp.text();
      return { success: false, error: `Drive upload failed (${uploadResp.status}): ${errText.substring(0, 200)}` };
    }

    const uploadResult = await uploadResp.json();
    console.log(`[retry-drive-upload] OK: ${fileName} -> fileId=${uploadResult.fileId}`);
    return { success: true, fileId: uploadResult.fileId };
  } catch (err: any) {
    return { success: false, error: err.message };
  }
}
