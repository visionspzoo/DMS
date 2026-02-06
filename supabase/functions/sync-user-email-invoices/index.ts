/*
  # Sync User Email Invoices Edge Function

  This function connects to user's email accounts via IMAP,
  downloads PDF attachments, and imports them as invoices.

  Features:
  - IMAP connection to various email providers
  - PDF attachment extraction
  - Automatic invoice creation
  - OCR processing integration
*/

import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface EmailConfig {
  id: string;
  user_id: string;
  email_address: string;
  provider: string;
  imap_server: string;
  imap_port: number;
  email_username: string;
  email_password: string;
  is_active: boolean;
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

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      throw new Error("Missing authorization header");
    }

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    const { data: { user }, error: userError } = await supabase.auth.getUser(token);

    if (userError || !user) {
      throw new Error("Unauthorized");
    }

    const { data: emailConfigs, error: configError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", user.id)
      .eq("is_active", true);

    if (configError) {
      throw new Error(`Failed to load email configs: ${configError.message}`);
    }

    if (!emailConfigs || emailConfigs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "No active email configurations found",
          synced: 0,
        }),
        {
          headers: {
            ...corsHeaders,
            "Content-Type": "application/json",
          },
        }
      );
    }

    let totalSynced = 0;
    const errors: string[] = [];

    for (const config of emailConfigs as EmailConfig[]) {
      try {
        const synced = await syncEmailAccount(supabase, config, user.id);
        totalSynced += synced;

        await supabase
          .from("user_email_configs")
          .update({ last_sync_at: new Date().toISOString() })
          .eq("id", config.id);
      } catch (error: any) {
        console.error(`Error syncing ${config.email_address}:`, error);
        errors.push(`${config.email_address}: ${error.message}`);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: `Synced ${totalSynced} invoice(s) from ${emailConfigs.length} email account(s)`,
        synced: totalSynced,
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
    console.error("Error in sync-user-email-invoices:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message,
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

async function syncEmailAccount(
  supabase: any,
  config: EmailConfig,
  userId: string
): Promise<number> {
  console.log(`Connecting to ${config.email_address} via IMAP...`);

  const ImapClient = (await import("npm:emailjs-imap-client@3.1.0")).default;

  const client = new ImapClient(config.imap_server, config.imap_port, {
    auth: {
      user: config.email_username,
      pass: config.email_password,
    },
    useSecureTransport: true,
    logLevel: "error",
  });

  await client.connect();
  console.log("Connected to IMAP server");

  await client.selectMailbox("INBOX");
  console.log("Selected INBOX");

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const dateStr = thirtyDaysAgo.toISOString().split("T")[0].replace(/-/g, "");

  const messages = await client.search("INBOX", {
    since: dateStr,
    unseen: true,
  });

  console.log(`Found ${messages.length} unread messages`);

  let syncedCount = 0;

  for (const msgSeq of messages.slice(0, 10)) {
    try {
      const messageInfo = await client.listMessages("INBOX", msgSeq, [
        "body.peek[]",
        "uid",
      ]);

      if (!messageInfo || messageInfo.length === 0) continue;

      const message = messageInfo[0];
      const bodyPart = message["body[]"];

      if (!bodyPart) continue;

      const { default: PostalMime } = await import("npm:postal-mime@2.2.0");
      const parser = new PostalMime();
      const email = await parser.parse(bodyPart);

      if (!email.attachments || email.attachments.length === 0) {
        continue;
      }

      for (const attachment of email.attachments) {
        if (!attachment.filename?.toLowerCase().endsWith(".pdf")) {
          continue;
        }

        console.log(`Processing attachment: ${attachment.filename}`);

        const pdfContent = attachment.content;

        const fileName = `${Date.now()}_${attachment.filename}`;
        const filePath = `invoices/${fileName}`;

        const { data: uploadData, error: uploadError } = await supabase.storage
          .from("documents")
          .upload(filePath, pdfContent, {
            contentType: "application/pdf",
          });

        if (uploadError) {
          console.error("Upload error:", uploadError);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage
          .from("documents")
          .getPublicUrl(filePath);

        const base64Content = btoa(
          String.fromCharCode(...new Uint8Array(pdfContent))
        );

        const { data: invoiceData, error: insertError } = await supabase
          .from("invoices")
          .insert({
            file_url: publicUrl,
            pdf_base64: base64Content,
            uploaded_by: userId,
            description: `Faktura z email: ${config.email_address}`,
          })
          .select()
          .single();

        if (insertError) {
          console.error("Insert error:", insertError);
          continue;
        }

        console.log(`Created invoice: ${invoiceData.id}`);

        try {
          const ocrResponse = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-invoice-ocr`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({
                fileUrl: publicUrl,
                invoiceId: invoiceData.id,
              }),
            }
          );

          if (ocrResponse.ok) {
            console.log(`OCR processed for invoice ${invoiceData.id}`);
          }
        } catch (ocrError) {
          console.error("OCR error:", ocrError);
        }

        syncedCount++;
      }
    } catch (msgError: any) {
      console.error("Error processing message:", msgError);
    }
  }

  await client.close();
  console.log(`Synced ${syncedCount} invoices from ${config.email_address}`);

  return syncedCount;
}
