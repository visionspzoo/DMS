import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
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

function uint8ToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    for (let j = 0; j < chunk.length; j++) {
      binary += String.fromCharCode(chunk[j]);
    }
  }
  return btoa(binary);
}

async function computeFileHash(data: Uint8Array): Promise<string> {
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, {
      status: 200,
      headers: corsHeaders,
    });
  }

  try {
    const url = new URL(req.url);
    const isDiag = url.searchParams.get("diag") === "1";

    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const authHeader = req.headers.get("Authorization");
    if (!authHeader) {
      return new Response(
        JSON.stringify({ success: false, error: "Brak nagłówka autoryzacji" }),
        {
          status: 401,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY")!;
    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;

    if (token === supabaseServiceKey) {
      const body = await req.json().catch(() => ({}));
      if (!body.user_id) {
        return new Response(
          JSON.stringify({ success: false, error: "Brak user_id w trybie cron" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = body.user_id;
    } else {
      const userClient = createClient(supabaseUrl, supabaseAnonKey, {
        global: { headers: { Authorization: authHeader } },
      });
      const { data: { user }, error: userError } = await userClient.auth.getUser();
      if (userError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Nieautoryzowany: " + (userError?.message || "brak użytkownika") }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
    }

    const { data: emailConfigs, error: configError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (configError) {
      return new Response(
        JSON.stringify({
          success: false,
          error: `Błąd ładowania konfiguracji: ${configError.message}`,
        }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (!emailConfigs || emailConfigs.length === 0) {
      return new Response(
        JSON.stringify({
          success: true,
          message: "Brak aktywnych konfiguracji email",
          synced: 0,
        }),
        {
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    if (isDiag) {
      const diagResults = [];
      for (const config of emailConfigs as EmailConfig[]) {
        const diagResult: any = { email: config.email_address, steps: [] };
        try {
          const accessToken = await getValidAccessToken(supabase, config);
          diagResult.steps.push({ step: "token", ok: true });

          const fourteenDaysAgo = new Date();
          fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
          const afterDate = Math.floor(fourteenDaysAgo.getTime() / 1000);

          const listResponse = await fetch(
            `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=20&q=after:${afterDate} has:attachment filename:pdf`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const listBody = await listResponse.json();
          diagResult.steps.push({
            step: "gmail_list",
            ok: listResponse.ok,
            status: listResponse.status,
            messageCount: listBody.messages?.length ?? 0,
            resultSizeEstimate: listBody.resultSizeEstimate,
          });

          if (listBody.messages && listBody.messages.length > 0) {
            const { data: processed } = await supabase
              .from("processed_email_messages")
              .select("message_uid")
              .eq("email_config_id", config.id);
            const processedUids = new Set((processed || []).map((m: any) => m.message_uid));
            const newMessages = listBody.messages.filter((m: any) => !processedUids.has(m.id));
            diagResult.steps.push({
              step: "already_processed",
              total: listBody.messages.length,
              alreadyProcessed: processedUids.size,
              new: newMessages.length,
            });

            if (newMessages.length > 0) {
              const firstMsg = newMessages[0];
              const msgResp = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstMsg.id}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              const msgData = await msgResp.json();
              const pdfParts: any[] = [];
              function collectPdfParts(payload: any) {
                if (!payload) return;
                if (payload.filename?.toLowerCase().endsWith(".pdf") && payload.body?.attachmentId) {
                  pdfParts.push({ filename: payload.filename, mimeType: payload.mimeType });
                }
                if (payload.parts) payload.parts.forEach(collectPdfParts);
              }
              collectPdfParts(msgData.payload);
              diagResult.steps.push({
                step: "sample_message",
                messageId: firstMsg.id,
                subject: msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value,
                pdfAttachments: pdfParts,
              });
            }
          }
        } catch (e: any) {
          diagResult.error = e.message;
        }
        diagResults.push(diagResult);
      }
      return new Response(
        JSON.stringify({ diag: true, results: diagResults }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    let totalSynced = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const config of emailConfigs as EmailConfig[]) {
      try {
        const synced = await syncEmailAccount(supabase, config, userId, warnings);
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
        success: errors.length === 0,
        message: `Zsynchronizowano ${totalSynced} faktur z ${emailConfigs.length} kont`,
        synced: totalSynced,
        errors: errors.length > 0 ? errors : undefined,
        warnings: warnings.length > 0 ? warnings : undefined,
      }),
      {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error: any) {
    console.error("Error in sync-user-email-invoices:", error);
    return new Response(
      JSON.stringify({
        success: false,
        error: error.message || "Nieznany błąd serwera",
      }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});

async function refreshAccessToken(
  supabase: any,
  config: EmailConfig
): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");

  if (!googleClientId || !googleClientSecret) {
    throw new Error(
      "Brak konfiguracji GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET w sekretach Supabase"
    );
  }

  if (!config.oauth_refresh_token) {
    throw new Error(
      "Brak refresh tokena. Odłącz i połącz ponownie konto Google."
    );
  }

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
    const errorBody = await tokenResponse.text();
    console.error("Token refresh failed:", errorBody);
    throw new Error(
      `Nie udało się odświeżyć tokena Google (${tokenResponse.status}). Odłącz i połącz ponownie konto.`
    );
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
  userId: string,
  warnings: string[]
): Promise<number> {
  console.log(`Connecting to Gmail for ${config.email_address}...`);

  const accessToken = await getValidAccessToken(supabase, config);

  const fourteenDaysAgo = new Date();
  fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
  const afterDate = Math.floor(fourteenDaysAgo.getTime() / 1000);

  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=after:${afterDate} has:attachment filename:pdf`,
    {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    }
  );

  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    console.error("Gmail API error:", errorText);
    throw new Error(
      `Gmail API błąd (${listResponse.status}): ${errorText.substring(0, 200)}`
    );
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

      function collectPdfParts(payload: any): any[] {
        if (!payload) return [];
        const results: any[] = [];
        if (
          payload.filename &&
          payload.filename.toLowerCase().endsWith(".pdf") &&
          payload.body?.attachmentId
        ) {
          results.push(payload);
        }
        if (payload.parts && Array.isArray(payload.parts)) {
          for (const p of payload.parts) {
            results.push(...collectPdfParts(p));
          }
        }
        return results;
      }

      const pdfParts = collectPdfParts(message.payload);
      console.log(`Message ${messageId}: found ${pdfParts.length} PDF attachment(s)`);

      for (const part of pdfParts) {
        attachmentCount++;

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
          const rawData = attachmentData.data
            .replace(/-/g, "+")
            .replace(/_/g, "/");
          const pdfData = Uint8Array.from(atob(rawData), (c) =>
            c.charCodeAt(0)
          );

          const fileHash = await computeFileHash(pdfData);

          const { data: existingInvoice } = await supabase
            .from("invoices")
            .select("id, invoice_number")
            .eq("file_hash", fileHash)
            .eq("uploaded_by", userId)
            .maybeSingle();

          if (existingInvoice) {
            console.log(
              `Duplicate detected for ${part.filename} (hash: ${fileHash.substring(0, 12)}..., existing invoice: ${existingInvoice.id}), skipping`
            );
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

          const {
            data: { publicUrl },
          } = supabase.storage.from("documents").getPublicUrl(filePath);

          const base64Content = uint8ToBase64(pdfData);

          const { data: invoiceData, error: insertError } = await supabase
            .from("invoices")
            .insert({
              file_url: publicUrl,
              pdf_base64: base64Content,
              uploaded_by: userId,
              source: `email:${config.email_address}`,
              file_hash: fileHash,
            })
            .select()
            .single();

          if (insertError) {
            console.error("Insert error:", insertError);

            // Check if it's a duplicate file hash error
            if (insertError.message && insertError.message.includes('idx_invoices_file_hash_per_user')) {
              warnings.push(`Pominięto załącznik z emaila - plik został już wcześniej dodany`);
            }
            // Check if it's a foreign key constraint error (notifications)
            else if (insertError.message && insertError.message.includes('notifications_invoice_id_fkey')) {
              warnings.push(`Błąd zapisu załącznika z emaila - problem z notyfikacjami`);
            }
            // Generic error
            else {
              warnings.push(`Nie udało się zapisać załącznika z emaila: ${insertError.message}`);
            }
            continue;
          }

          console.log(`Created invoice: ${invoiceData.id}`);

          try {
            const ocrResponse = await fetch(
              `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-invoice-ocr`,
              {
                method: "POST",
                headers: {
                  Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                  "Content-Type": "application/json",
                },
                body: JSON.stringify({
                  fileUrl: publicUrl,
                  invoiceId: invoiceData.id,
                }),
              }
            );

            if (ocrResponse.ok) {
              const ocrData = await ocrResponse.json();
              console.log(`OCR processed for invoice ${invoiceData.id}`);

              if (ocrData.validationError) {
                warnings.push(`${part.filename}: ${ocrData.validationError}`);
              }
            }
          } catch (ocrError) {
            console.error("OCR error:", ocrError);
          }

          invoiceCount++;
          syncedCount++;
      }

      if (invoiceCount > 0 || attachmentCount === 0) {
        await supabase.from("processed_email_messages").insert({
          email_config_id: config.id,
          message_uid: messageId,
          message_id: messageId,
          attachment_count: attachmentCount,
          invoice_count: invoiceCount,
        });
        processedUids.add(messageId);
      } else {
        console.log(`Message ${messageId}: had ${attachmentCount} PDF(s) but 0 invoices saved - will retry next sync`);
      }
    } catch (msgError: any) {
      console.error("Error processing message:", msgError);
    }
  }

  console.log(`Synced ${syncedCount} invoices from ${config.email_address}`);

  return syncedCount;
}

async function verifyIsInvoice(pdfContent: Uint8Array): Promise<boolean> {
  try {
    const base64Content = uint8ToBase64(pdfContent);

    const extractResponse = await fetch(
      `${Deno.env.get("SUPABASE_URL")}/functions/v1/extract-pdf-text`,
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          pdf_base64: base64Content,
        }),
      }
    );

    if (!extractResponse.ok) {
      console.error("Failed to extract PDF text for verification");
      return true;
    }

    const { text } = await extractResponse.json();

    if (!text || text.trim().length < 50) {
      console.log("PDF text too short or empty - treating as invoice (likely scanned PDF)");
      return true;
    }

    const lowerText = text.toLowerCase();

    const invoiceKeywords = [
      "faktura",
      "invoice",
      "faktura vat",
      "faktura proforma",
      "nr faktury",
      "invoice number",
      "invoice no",
      "nip",
      "tax id",
      "vat",
      "kwota",
      "amount",
      "sprzedawca",
      "seller",
      "nabywca",
      "buyer",
    ];

    const foundKeywords = invoiceKeywords.filter((keyword) =>
      lowerText.includes(keyword)
    );

    const isInvoice = foundKeywords.length >= 2;

    console.log(
      `PDF verification: ${isInvoice ? "IS" : "NOT"} an invoice (found ${foundKeywords.length} keywords: ${foundKeywords.join(", ")})`
    );

    return isInvoice;
  } catch (error) {
    console.error("Error verifying PDF:", error);
    return true;
  }
}
