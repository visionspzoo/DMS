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

function sseEvent(data: object): string {
  return `data: ${JSON.stringify(data)}\n\n`;
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
    const isStream = url.searchParams.get("stream") === "1";

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

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const token = authHeader.replace("Bearer ", "");
    let userId: string;
    let bodyData: any = {};

    if (token === supabaseServiceKey) {
      bodyData = await req.json().catch(() => ({}));
      if (!bodyData.user_id) {
        return new Response(
          JSON.stringify({ success: false, error: "Brak user_id w trybie cron" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = bodyData.user_id;
    } else {
      bodyData = await req.json().catch(() => ({}));
      const { data: { user }, error: userError } = await supabase.auth.getUser(token);
      if (userError || !user) {
        return new Response(
          JSON.stringify({ success: false, error: "Nieautoryzowany: " + (userError?.message || "brak użytkownika") }),
          { status: 401, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
      userId = user.id;
    }

    const forceReimport = bodyData.force_reimport === true;
    const allowDuplicates = forceReimport;
    const dateFrom = bodyData.date_from ? new Date(bodyData.date_from) : null;
    const dateTo = bodyData.date_to ? new Date(bodyData.date_to) : null;

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

            const allMessages = listBody.messages;
            const firstMsg = allMessages[0];
            const msgResp = await fetch(
              `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstMsg.id}`,
              { headers: { Authorization: `Bearer ${accessToken}` } }
            );
            const msgData = await msgResp.json();
            const pdfParts: any[] = [];
            function collectPdfParts2(payload: any) {
              if (!payload) return;
              if (payload.filename?.toLowerCase().endsWith(".pdf") && payload.body?.attachmentId) {
                pdfParts.push({ filename: payload.filename, mimeType: payload.mimeType, attachmentId: payload.body.attachmentId });
              }
              if (payload.parts) payload.parts.forEach(collectPdfParts2);
            }
            collectPdfParts2(msgData.payload);
            diagResult.steps.push({
              step: "sample_message",
              messageId: firstMsg.id,
              alreadyProcessed: processedUids.has(firstMsg.id),
              subject: msgData.payload?.headers?.find((h: any) => h.name === "Subject")?.value,
              pdfAttachments: pdfParts,
            });

            if (pdfParts.length > 0) {
              const firstPdf = pdfParts[0];
              const attResp = await fetch(
                `https://gmail.googleapis.com/gmail/v1/users/me/messages/${firstMsg.id}/attachments/${firstPdf.attachmentId}`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (!attResp.ok) {
                diagResult.steps.push({ step: "attachment_fetch", ok: false, status: attResp.status });
              } else {
                const attData = await attResp.json();
                const rawData = attData.data.replace(/-/g, "+").replace(/_/g, "/");
                const pdfBytes = Uint8Array.from(atob(rawData), (c) => c.charCodeAt(0));
                diagResult.steps.push({ step: "attachment_fetch", ok: true, sizeBytes: pdfBytes.length });

                const fileHash = await computeFileHash(pdfBytes);
                diagResult.steps.push({ step: "hash", hash: fileHash.substring(0, 16) + "..." });

                const testPath = `invoices/diag_test_${Date.now()}.pdf`;
                const { error: storageErr } = await supabase.storage.from("documents").upload(testPath, pdfBytes, { contentType: "application/pdf" });
                if (storageErr) {
                  diagResult.steps.push({ step: "storage_upload", ok: false, error: storageErr.message });
                } else {
                  diagResult.steps.push({ step: "storage_upload", ok: true });
                  await supabase.storage.from("documents").remove([testPath]);

                  const { data: insertTest, error: insertErr } = await supabase.from("invoices").insert({
                    file_url: "https://test.example.com/test.pdf",
                    uploaded_by: userId,
                    source: 'email',
                    file_hash: fileHash + "_diagtest",
                  }).select("id").single();
                  if (insertErr) {
                    diagResult.steps.push({ step: "invoice_insert", ok: false, error: insertErr.message, code: insertErr.code });
                  } else {
                    diagResult.steps.push({ step: "invoice_insert", ok: true, id: insertTest.id });
                    await supabase.from("invoices").delete().eq("id", insertTest.id);
                  }
                }
              }
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

    if (isStream) {
      const stream = new TransformStream();
      const writer = stream.writable.getWriter();
      const encoder = new TextEncoder();

      const send = async (data: object) => {
        await writer.write(encoder.encode(sseEvent(data)));
      };

      EdgeRuntime.waitUntil((async () => {
        try {
          let totalSynced = 0;
          const errors: string[] = [];
          const warnings: string[] = [];

          for (const config of emailConfigs as EmailConfig[]) {
            try {
              await send({ type: "account_start", email: config.email_address });
              const synced = await syncEmailAccount(
                supabase, config, userId, warnings, send,
                forceReimport, dateFrom, dateTo, allowDuplicates
              );
              totalSynced += synced;

              await supabase
                .from("user_email_configs")
                .update({ last_sync_at: new Date().toISOString() })
                .eq("id", config.id);
            } catch (error: any) {
              console.error(`Error syncing ${config.email_address}:`, error);
              errors.push(`${config.email_address}: ${error.message}`);
              await send({ type: "account_error", email: config.email_address, error: error.message });
            }
          }

          await send({
            type: "done",
            success: errors.length === 0,
            synced: totalSynced,
            errors: errors.length > 0 ? errors : undefined,
            warnings: warnings.length > 0 ? warnings : undefined,
          });
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

    let totalSynced = 0;
    const errors: string[] = [];
    const warnings: string[] = [];

    for (const config of emailConfigs as EmailConfig[]) {
      try {
        const synced = await syncEmailAccount(
          supabase, config, userId, warnings, undefined,
          forceReimport, dateFrom, dateTo, allowDuplicates
        );
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
  if (!config.oauth_access_token || !config.oauth_token_expiry) {
    console.log("No access token or expiry - refreshing...");
    return await refreshAccessToken(supabase, config);
  }

  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  const now = Date.now();

  if (isNaN(expiryTime) || now >= expiryTime - 5 * 60 * 1000) {
    console.log("Token expired or expiring soon, refreshing...");
    return await refreshAccessToken(supabase, config);
  }

  return config.oauth_access_token;
}

async function syncEmailAccount(
  supabase: any,
  config: EmailConfig,
  userId: string,
  warnings: string[],
  send?: (data: object) => Promise<void>,
  forceReimport = false,
  dateFrom: Date | null = null,
  dateTo: Date | null = null,
  allowDuplicates = false
): Promise<number> {
  console.log(`Connecting to Gmail for ${config.email_address}... forceReimport=${forceReimport}`);

  const accessToken = await getValidAccessToken(supabase, config);

  let afterDate: number;
  let beforeDate: number | null = null;

  if (forceReimport && dateFrom) {
    afterDate = Math.floor(dateFrom.getTime() / 1000);
    if (dateTo) {
      beforeDate = Math.floor(dateTo.getTime() / 1000);
    }
  } else {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    afterDate = Math.floor(fourteenDaysAgo.getTime() / 1000);
  }

  let query = `after:${afterDate} has:attachment filename:pdf`;
  if (beforeDate) {
    query += ` before:${beforeDate}`;
  }

  const listResponse = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=100&q=${encodeURIComponent(query)}`,
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
    if (send) await send({ type: "no_messages", email: config.email_address });
    return 0;
  }

  console.log(`Found ${messages.length} messages with attachments`);

  let processedUids: Set<string>;

  if (forceReimport) {
    processedUids = new Set<string>();
    console.log("Force reimport mode: ignoring processed message history");
  } else {
    const { data: processedMessages } = await supabase
      .from("processed_email_messages")
      .select("message_uid")
      .eq("email_config_id", config.id);

    processedUids = new Set(
      (processedMessages || []).map((m: any) => m.message_uid)
    );
  }

  const newMessages = forceReimport
    ? messages
    : messages.filter((m: any) => !processedUids.has(m.id));
  const totalNew = newMessages.length;

  if (send) {
    await send({
      type: "messages_found",
      email: config.email_address,
      total: messages.length,
      new: totalNew,
      force_reimport: forceReimport,
    });
  }

  let syncedCount = 0;
  let processedCount = 0;

  for (const msg of messages) {
    try {
      const messageId = msg.id;

      if (!forceReimport && processedUids.has(messageId)) {
        continue;
      }

      processedCount++;
      if (send) {
        await send({
          type: "processing_message",
          email: config.email_address,
          current: processedCount,
          total: totalNew,
        });
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
      const subject = message.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "";
      console.log(`Message ${messageId}: found ${pdfParts.length} PDF attachment(s)`);

      for (const part of pdfParts) {
        attachmentCount++;

        if (send) {
          await send({
            type: "processing_attachment",
            email: config.email_address,
            filename: part.filename,
            subject,
            current: processedCount,
            total: totalNew,
          });
        }

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

          if (!allowDuplicates) {
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
              if (send) {
                await send({ type: "attachment_skipped", filename: part.filename, reason: "duplicate" });
              }
              continue;
            }
          }

          const sanitizedFilename = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
          const fileName = `${Date.now()}_${sanitizedFilename}`;
          const filePath = `invoices/${fileName}`;

          if (send) {
            await send({ type: "uploading", filename: part.filename });
          }

          const { error: uploadError } = await supabase.storage
            .from("documents")
            .upload(filePath, pdfData, {
              contentType: "application/pdf",
              upsert: true,
            });

          if (uploadError) {
            console.error("Upload error:", uploadError.message);
            warnings.push(`Błąd uploadu pliku ${part.filename}: ${uploadError.message}`);
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
              source: 'email',
              file_hash: allowDuplicates ? null : fileHash,
            })
            .select()
            .single();

          if (insertError) {
            console.error("Insert error:", insertError);

            if (insertError.message && insertError.message.includes('idx_invoices_file_hash_per_user')) {
              warnings.push(`Pominięto załącznik z emaila - plik został już wcześniej dodany`);
            } else if (insertError.message && insertError.message.includes('notifications_invoice_id_fkey')) {
              warnings.push(`Błąd zapisu załącznika z emaila - problem z notyfikacjami`);
            } else {
              warnings.push(`Nie udało się zapisać załącznika z emaila: ${insertError.message}`);
            }
            continue;
          }

          console.log(`Created invoice: ${invoiceData.id}`);

          if (send) {
            await send({ type: "invoice_created", filename: part.filename, invoiceId: invoiceData.id });
          }

          let isRealInvoice = false;
          try {
            if (send) {
              await send({ type: "ocr_start", filename: part.filename });
            }

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

              const d = ocrData.data || {};
              const hasInvoiceNumber = d.invoice_number && String(d.invoice_number).trim().length > 0 && d.invoice_number !== 'null';
              const hasAmount = d.gross_amount && String(d.gross_amount).trim().length > 0 && d.gross_amount !== 'null';
              const hasSupplier = d.supplier_name && String(d.supplier_name).trim().length > 0 && d.supplier_name !== 'null';
              isRealInvoice = !!(hasInvoiceNumber || (hasAmount && hasSupplier));

              if (!isRealInvoice) {
                console.log(`Not an invoice (${part.filename}), deleting record and file`);
                await supabase.from("invoices").delete().eq("id", invoiceData.id);
                await supabase.storage.from("documents").remove([filePath]);
                if (send) {
                  await send({ type: "attachment_skipped", filename: part.filename, reason: "not_invoice" });
                }
              } else {
                if (ocrData.validationError) {
                  warnings.push(`${part.filename}: ${ocrData.validationError}`);
                }
                if (send) {
                  await send({ type: "ocr_done", filename: part.filename });
                }
              }
            } else {
              isRealInvoice = true;
            }
          } catch (ocrError) {
            console.error("OCR error:", ocrError);
            isRealInvoice = true;
          }

          if (!isRealInvoice) continue;

          // Upload to Google Drive
          try {
            const { data: refreshedInvoice } = await supabase
              .from("invoices")
              .select("id, department_id, status, issue_date")
              .eq("id", invoiceData.id)
              .maybeSingle();

            const deptId = refreshedInvoice?.department_id;
            const issueDate = refreshedInvoice?.issue_date || null;

            let targetFolderId: string | null = null;

            if (deptId) {
              const { data: deptData } = await supabase
                .from("departments")
                .select("google_drive_draft_folder_id")
                .eq("id", deptId)
                .maybeSingle();
              if (deptData?.google_drive_draft_folder_id) {
                targetFolderId = deptData.google_drive_draft_folder_id;
              }
            }

            if (!targetFolderId) {
              const { data: userDriveConfig } = await supabase
                .from("user_drive_configs")
                .select("google_drive_folder_id")
                .eq("user_id", userId)
                .eq("is_active", true)
                .maybeSingle();
              if (userDriveConfig?.google_drive_folder_id) {
                targetFolderId = userDriveConfig.google_drive_folder_id;
              }
            }

            if (!targetFolderId) {
              const { data: folderMapping } = await supabase
                .from("user_drive_folder_mappings")
                .select("google_drive_folder_id")
                .eq("user_id", userId)
                .eq("is_active", true)
                .order("created_at", { ascending: false })
                .limit(1)
                .maybeSingle();
              if (folderMapping?.google_drive_folder_id) {
                targetFolderId = folderMapping.google_drive_folder_id;
              }
            }

            if (targetFolderId) {
              const uploadPayload: any = {
                fileBase64: base64Content,
                fileName: part.filename,
                folderId: targetFolderId,
                mimeType: "application/pdf",
                originalMimeType: "application/pdf",
                userId: userId,
                invoiceId: invoiceData.id,
              };
              if (issueDate) {
                uploadPayload.issueDate = issueDate;
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
              if (uploadResp.ok) {
                console.log(`[email-sync] Uploaded ${part.filename} to Drive folder${issueDate ? ` (${issueDate})` : ""}`);
              } else {
                console.warn(`[email-sync] Drive upload failed: ${await uploadResp.text()}`);
              }
            } else {
              console.log(`[email-sync] No Drive folder configured for user ${userId}, skipping Drive upload`);
            }
          } catch (driveErr) {
            console.error("[email-sync] Error uploading to Drive:", driveErr);
          }

          invoiceCount++;
          syncedCount++;
      }

      if (!forceReimport) {
        await supabase.from("processed_email_messages").insert({
          email_config_id: config.id,
          message_uid: messageId,
          message_id: messageId,
          attachment_count: attachmentCount,
          invoice_count: invoiceCount,
        }).then(({ error: pErr }: { error: any }) => {
          if (pErr) console.error("Error marking message as processed:", pErr);
        });
        processedUids.add(messageId);
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
