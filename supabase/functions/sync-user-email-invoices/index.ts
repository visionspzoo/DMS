/*
  # Sync User Email Invoices Edge Function

  This function connects to user's email accounts via Gmail API (OAuth),
  downloads PDF attachments, and imports them as invoices.

  Features:
  - Gmail API connection with OAuth tokens
  - PDF attachment extraction
  - Automatic invoice creation
  - OCR processing integration
  - Smart duplicate detection
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
  oauth_access_token: string;
  oauth_refresh_token: string;
  oauth_token_expiry: string;
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

async function refreshAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID")!;
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET")!;

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({
      client_id: googleClientId,
      client_secret: googleClientSecret,
      refresh_token: config.oauth_refresh_token,
      grant_type: "refresh_token",
    }),
  });

  if (!tokenResponse.ok) {
    throw new Error("Failed to refresh access token");
  }

  const tokens = await tokenResponse.json();

  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

  await supabase
    .from("user_email_configs")
    .update({
      oauth_access_token: tokens.access_token,
      oauth_token_expiry: expiryDate.toISOString(),
    })
    .eq("id", config.id);

  return tokens.access_token;
}

async function getValidAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  const now = new Date().getTime();

  if (now >= expiryTime - 5 * 60 * 1000) {
    console.log("Token expired or expiring soon, refreshing...");
    return await refreshAccessToken(supabase, config);
  }

  return config.oauth_access_token;
}

async function syncEmailAccount(
  supabase: any,
  config: EmailConfig,
  userId: string
): Promise<number> {
  console.log(`Connecting to Gmail for ${config.email_address}...`);

  const accessToken = await getValidAccessToken(supabase, config);

  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const afterDate = Math.floor(thirtyDaysAgo.getTime() / 1000);

  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=50&q=after:${afterDate} has:attachment`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!listResponse.ok) {
    const errorData = await listResponse.json();
    throw new Error(`Failed to list messages: ${JSON.stringify(errorData)}`);
  }

  const { messages } = await listResponse.json();

  if (!messages || messages.length === 0) {
    console.log("No messages found with attachments");
    return 0;
  }

  console.log(`Found ${messages.length} messages with attachments`);

  const { data: processedMessages } = await supabase
    .from("processed_email_messages")
    .select("message_uid")
    .eq("email_config_id", config.id);

  const processedUids = new Set(
    (processedMessages || []).map((m: any) => m.message_uid)
  );

  let syncedCount = 0;

  for (const msg of messages) {
    try {
      const messageId = msg.id;

      if (processedUids.has(messageId)) {
        console.log(`Message ${messageId} already processed, skipping`);
        continue;
      }

      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        {
          headers: {
            Authorization: `Bearer ${accessToken}`,
          },
        }
      );

      if (!messageResponse.ok) {
        console.error(`Failed to fetch message ${messageId}`);
        continue;
      }

      const message = await messageResponse.json();

      let attachmentCount = 0;
      let invoiceCount = 0;

      if (message.payload.parts) {
        for (const part of message.payload.parts) {
          if (part.filename && part.filename.toLowerCase().endsWith(".pdf") && part.body.attachmentId) {
            attachmentCount++;
            console.log(`Processing attachment: ${part.filename}`);

            const attachmentResponse = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
              {
                headers: {
                  Authorization: `Bearer ${accessToken}`,
                },
              }
            );

            if (!attachmentResponse.ok) {
              console.error(`Failed to fetch attachment ${part.filename}`);
              continue;
            }

            const attachmentData = await attachmentResponse.json();
            const pdfData = Uint8Array.from(atob(attachmentData.data.replace(/-/g, '+').replace(/_/g, '/')), c => c.charCodeAt(0));

            const isInvoice = await verifyIsInvoice(pdfData);
            if (!isInvoice) {
              console.log(`Attachment ${part.filename} is not an invoice, skipping`);
              continue;
            }

            const fileName = `${Date.now()}_${part.filename}`;
            const filePath = `invoices/${fileName}`;

            const { error: uploadError } = await supabase.storage
              .from("documents")
              .upload(filePath, pdfData, {
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
              String.fromCharCode(...new Uint8Array(pdfData))
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

            invoiceCount++;
            syncedCount++;
          }
        }
      }

      await supabase.from("processed_email_messages").insert({
        email_config_id: config.id,
        message_uid: messageId,
        message_id: messageId,
        attachment_count: attachmentCount,
        invoice_count: invoiceCount,
      });

      processedUids.add(messageId);
    } catch (msgError: any) {
      console.error("Error processing message:", msgError);
    }
  }

  console.log(`Synced ${syncedCount} invoices from ${config.email_address}`);

  return syncedCount;
}

async function verifyIsInvoice(pdfContent: Uint8Array): Promise<boolean> {
  try {
    const base64Content = btoa(
      String.fromCharCode(...new Uint8Array(pdfContent))
    );

    const extractResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/extract-pdf-text`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdfBase64: base64Content,
        }),
      }
    );

    if (!extractResponse.ok) {
      console.error("Failed to extract PDF text for verification");
      return true;
    }

    const { text } = await extractResponse.json();
    const lowerText = text.toLowerCase();

    const invoiceKeywords = [
      "faktura", "invoice", "faktura vat", "faktura proforma",
      "nr faktury", "invoice number", "invoice no",
      "nip", "tax id", "vat", "kwota", "amount",
      "sprzedawca", "seller", "nabywca", "buyer"
    ];

    const foundKeywords = invoiceKeywords.filter(keyword =>
      lowerText.includes(keyword)
    );

    const isInvoice = foundKeywords.length >= 3;

    console.log(`PDF verification: ${isInvoice ? "IS" : "NOT"} an invoice (found ${foundKeywords.length} keywords)`);

    return isInvoice;
  } catch (error) {
    console.error("Error verifying PDF:", error);
    return true;
  }
}
