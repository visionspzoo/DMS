import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const CHUNK_SIZE = 20;
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

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
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const url = new URL(req.url);
    const isDiag = url.searchParams.get("diag") === "1";
    const isStream = url.searchParams.get("stream") === "1";
    const isResumeChunk = url.searchParams.get("resume_chunk") === "1";

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

    const forceReimport = bodyData.force_reimport === true;
    const allowDuplicates = forceReimport;
    const dateFrom = bodyData.date_from ? new Date(bodyData.date_from) : null;
    const dateTo = bodyData.date_to ? new Date(bodyData.date_to) : null;
    const resumeJobId: string | null = bodyData.resume_job_id || null;

    const { data: emailConfigs, error: configError } = await supabase
      .from("user_email_configs")
      .select("*")
      .eq("user_id", userId)
      .eq("is_active", true);

    if (configError) {
      return new Response(
        JSON.stringify({ success: false, error: `Błąd ładowania konfiguracji: ${configError.message}` }),
        { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!emailConfigs || emailConfigs.length === 0) {
      return new Response(
        JSON.stringify({ success: true, message: "Brak aktywnych konfiguracji email", synced: 0 }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
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

    if (isResumeChunk) {
      if (!resumeJobId) {
        return new Response(
          JSON.stringify({ success: false, error: "Brak resume_job_id" }),
          { status: 400, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const { data: job, error: jobErr } = await supabase
        .from("email_sync_jobs")
        .select("*")
        .eq("id", resumeJobId)
        .maybeSingle();

      if (jobErr || !job) {
        return new Response(
          JSON.stringify({ success: false, error: "Job nie znaleziony" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      if (job.status === "completed" || job.status === "failed") {
        return new Response(
          JSON.stringify({ success: true, status: job.status, message: "Job już zakończony" }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      const config = (emailConfigs as EmailConfig[]).find(c => c.id === job.email_config_id);
      if (!config) {
        return new Response(
          JSON.stringify({ success: false, error: "Konfiguracja emaila nie znaleziona" }),
          { status: 404, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }

      await supabase.from("email_sync_jobs").update({ status: "running", last_chunk_at: new Date().toISOString() }).eq("id", resumeJobId);

      try {
        const result = await processEmailChunk(supabase, config, job, userId);

        if (result.nextPageToken || result.hasMore) {
          await supabase.from("email_sync_jobs").update({
            status: "pending",
            page_token: result.nextPageToken || null,
            messages_processed: job.messages_processed + result.processed,
            invoices_synced: job.invoices_synced + result.synced,
            last_chunk_at: new Date().toISOString(),
          }).eq("id", resumeJobId);

          scheduleNextChunk(supabaseUrl, supabaseServiceKey, resumeJobId, userId);
        } else {
          await supabase.from("email_sync_jobs").update({
            status: "completed",
            page_token: null,
            messages_processed: job.messages_processed + result.processed,
            invoices_synced: job.invoices_synced + result.synced,
            completed_at: new Date().toISOString(),
            last_chunk_at: new Date().toISOString(),
          }).eq("id", resumeJobId);

          await supabase.from("user_email_configs").update({ last_sync_at: new Date().toISOString() }).eq("id", config.id);
        }

        return new Response(
          JSON.stringify({ success: true, processed: result.processed, synced: result.synced, hasMore: result.hasMore }),
          { headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      } catch (err: any) {
        await supabase.from("email_sync_jobs").update({ status: "failed", error_message: err.message }).eq("id", resumeJobId);
        return new Response(
          JSON.stringify({ success: false, error: err.message }),
          { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
        );
      }
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

              const jobId = await createOrResumeSyncJob(supabase, config, userId, forceReimport, dateFrom, dateTo);
              await send({ type: "job_created", jobId, email: config.email_address });

              const { data: job } = await supabase.from("email_sync_jobs").select("*").eq("id", jobId).maybeSingle();
              if (!job) throw new Error("Job nie może być załadowany");

              const synced = await streamProcessAllChunks(supabase, config, job, userId, warnings, send);
              totalSynced += synced;

              await supabase.from("email_sync_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobId);
              await supabase.from("user_email_configs").update({ last_sync_at: new Date().toISOString() }).eq("id", config.id);
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
        const jobId = await createOrResumeSyncJob(supabase, config, userId, forceReimport, dateFrom, dateTo);
        const { data: job } = await supabase.from("email_sync_jobs").select("*").eq("id", jobId).maybeSingle();
        if (!job) continue;

        const synced = await streamProcessAllChunks(supabase, config, job, userId, warnings, undefined);
        totalSynced += synced;

        await supabase.from("email_sync_jobs").update({ status: "completed", completed_at: new Date().toISOString() }).eq("id", jobId);
        await supabase.from("user_email_configs").update({ last_sync_at: new Date().toISOString() }).eq("id", config.id);
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
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Error in sync-user-email-invoices:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message || "Nieznany błąd serwera" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});

function scheduleNextChunk(supabaseUrl: string, serviceKey: string, jobId: string, userId: string) {
  EdgeRuntime.waitUntil((async () => {
    await new Promise(r => setTimeout(r, 2000));
    try {
      await fetch(`${supabaseUrl}/functions/v1/sync-user-email-invoices?resume_chunk=1`, {
        method: "POST",
        headers: { Authorization: `Bearer ${serviceKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: userId, resume_job_id: jobId }),
      });
    } catch (e) {
      console.error("[scheduleNextChunk] error:", e);
    }
  })());
}

async function createOrResumeSyncJob(
  supabase: any,
  config: EmailConfig,
  userId: string,
  forceReimport: boolean,
  dateFrom: Date | null,
  dateTo: Date | null
): Promise<string> {
  if (!forceReimport) {
    const stallCutoff = new Date(Date.now() - STALL_TIMEOUT_MS).toISOString();
    const { data: existingJob } = await supabase
      .from("email_sync_jobs")
      .select("*")
      .eq("email_config_id", config.id)
      .eq("user_id", userId)
      .in("status", ["pending", "running"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();

    if (existingJob) {
      const isStalled = existingJob.status === "running" && existingJob.last_chunk_at < stallCutoff;
      if (!isStalled) {
        console.log(`[createOrResumeSyncJob] Resuming existing job ${existingJob.id}`);
        return existingJob.id;
      }
      await supabase.from("email_sync_jobs").update({ status: "failed", error_message: "Timeout - zadanie wznowione" }).eq("id", existingJob.id);
    }
  }

  let afterDate: number;
  let beforeDate: number | null = null;

  if (forceReimport && dateFrom) {
    const adjustedFrom = new Date(dateFrom);
    adjustedFrom.setDate(adjustedFrom.getDate() - 1);
    afterDate = Math.floor(adjustedFrom.getTime() / 1000);
    if (dateTo) {
      const adjustedTo = new Date(dateTo);
      adjustedTo.setDate(adjustedTo.getDate() + 1);
      beforeDate = Math.floor(adjustedTo.getTime() / 1000);
    }
  } else {
    const fourteenDaysAgo = new Date();
    fourteenDaysAgo.setDate(fourteenDaysAgo.getDate() - 14);
    afterDate = Math.floor(fourteenDaysAgo.getTime() / 1000);
  }

  let query = `after:${afterDate} has:attachment filename:pdf`;
  if (beforeDate) query += ` before:${beforeDate}`;

  const { data: newJob, error } = await supabase.from("email_sync_jobs").insert({
    user_id: userId,
    email_config_id: config.id,
    status: "pending",
    query,
    chunk_size: CHUNK_SIZE,
    force_reimport: forceReimport,
    date_from: dateFrom ? dateFrom.toISOString().split("T")[0] : null,
    date_to: dateTo ? dateTo.toISOString().split("T")[0] : null,
  }).select("id").single();

  if (error) throw new Error(`Nie można utworzyć job: ${error.message}`);
  return newJob.id;
}

async function streamProcessAllChunks(
  supabase: any,
  config: EmailConfig,
  job: any,
  userId: string,
  warnings: string[],
  send?: (data: object) => Promise<void>
): Promise<number> {
  let totalSynced = 0;
  let currentJob = job;

  while (true) {
    if (send) await send({ type: "chunk_start", email: config.email_address, processed: currentJob.messages_processed });

    await supabase.from("email_sync_jobs").update({ status: "running", last_chunk_at: new Date().toISOString() }).eq("id", currentJob.id);

    const result = await processEmailChunk(supabase, config, currentJob, userId, warnings, send);
    totalSynced += result.synced;

    if (send) {
      await send({
        type: "chunk_done",
        email: config.email_address,
        processed: currentJob.messages_processed + result.processed,
        synced: currentJob.invoices_synced + result.synced,
        hasMore: result.hasMore,
      });
    }

    if (result.hasMore) {
      const { data: updatedJob } = await supabase
        .from("email_sync_jobs")
        .update({
          status: "pending",
          page_token: result.nextPageToken || null,
          messages_processed: currentJob.messages_processed + result.processed,
          invoices_synced: currentJob.invoices_synced + result.synced,
          last_chunk_at: new Date().toISOString(),
        })
        .eq("id", currentJob.id)
        .select("*")
        .single();
      currentJob = updatedJob;
    } else {
      await supabase.from("email_sync_jobs").update({
        status: "completed",
        page_token: null,
        messages_processed: currentJob.messages_processed + result.processed,
        invoices_synced: currentJob.invoices_synced + result.synced,
        completed_at: new Date().toISOString(),
        last_chunk_at: new Date().toISOString(),
      }).eq("id", currentJob.id);
      break;
    }
  }

  return totalSynced;
}

async function processEmailChunk(
  supabase: any,
  config: EmailConfig,
  job: any,
  userId: string,
  warnings: string[] = [],
  send?: (data: object) => Promise<void>
): Promise<{ processed: number; synced: number; hasMore: boolean; nextPageToken?: string }> {
  const accessToken = await getValidAccessToken(supabase, config);

  let listUrl = `https://gmail.googleapis.com/gmail/v1/users/me/messages?maxResults=${job.chunk_size}&q=${encodeURIComponent(job.query)}`;
  if (job.page_token) {
    listUrl += `&pageToken=${encodeURIComponent(job.page_token)}`;
  }

  const listResponse = await fetch(listUrl, { headers: { Authorization: `Bearer ${accessToken}` } });
  if (!listResponse.ok) {
    const errorText = await listResponse.text();
    throw new Error(`Gmail API błąd (${listResponse.status}): ${errorText.substring(0, 200)}`);
  }

  const listBody = await listResponse.json();
  const messages = listBody.messages || [];
  const nextPageToken = listBody.nextPageToken || null;
  const hasMore = !!nextPageToken;

  if (messages.length === 0) {
    return { processed: 0, synced: 0, hasMore: false };
  }

  let processedUids: Set<string>;
  if (job.force_reimport) {
    processedUids = new Set<string>();
  } else {
    const { data: processedMessages } = await supabase
      .from("processed_email_messages")
      .select("message_uid")
      .eq("email_config_id", config.id);
    processedUids = new Set((processedMessages || []).map((m: any) => m.message_uid));
  }

  const newMessages = job.force_reimport ? messages : messages.filter((m: any) => !processedUids.has(m.id));

  if (send) {
    await send({
      type: "messages_found",
      email: config.email_address,
      chunkSize: messages.length,
      new: newMessages.length,
      hasMore,
    });
  }

  let syncedCount = 0;
  let processedCount = 0;

  for (const msg of newMessages) {
    try {
      const messageId = msg.id;
      processedCount++;

      if (send) {
        await send({
          type: "processing_message",
          email: config.email_address,
          current: job.messages_processed + processedCount,
        });
      }

      const messageResponse = await fetch(
        `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}`,
        { headers: { Authorization: `Bearer ${accessToken}` } }
      );
      if (!messageResponse.ok) continue;

      const message = await messageResponse.json();

      const pdfParts = collectPdfParts(message.payload);
      const subject = message.payload?.headers?.find((h: any) => h.name === "Subject")?.value || "";
      const emailDateHeader = message.payload?.headers?.find((h: any) => h.name === "Date")?.value || null;
      let emailDateIso: string | null = null;
      if (emailDateHeader) {
        const parsed = new Date(emailDateHeader);
        if (!isNaN(parsed.getTime())) emailDateIso = parsed.toISOString().split("T")[0];
      }
      if (!emailDateIso && message.internalDate) {
        const parsed = new Date(Number(message.internalDate));
        if (!isNaN(parsed.getTime())) emailDateIso = parsed.toISOString().split("T")[0];
      }

      let attachmentCount = 0;
      let invoiceCount = 0;

      for (const part of pdfParts) {
        attachmentCount++;

        if (send) {
          await send({ type: "processing_attachment", email: config.email_address, filename: part.filename, subject });
        }

        const attachmentResponse = await fetch(
          `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}/attachments/${part.body.attachmentId}`,
          { headers: { Authorization: `Bearer ${accessToken}` } }
        );
        if (!attachmentResponse.ok) continue;

        const attachmentData = await attachmentResponse.json();
        const rawData = attachmentData.data.replace(/-/g, "+").replace(/_/g, "/");
        const pdfData = Uint8Array.from(atob(rawData), (c) => c.charCodeAt(0));
        const fileHash = await computeFileHash(pdfData);

        if (!job.force_reimport) {
          const { data: existingInvoice } = await supabase
            .from("invoices")
            .select("id")
            .eq("file_hash", fileHash)
            .eq("uploaded_by", userId)
            .maybeSingle();
          if (existingInvoice) {
            if (send) await send({ type: "attachment_skipped", filename: part.filename, reason: "duplicate" });
            continue;
          }
        }

        const preCheckPass = await quickInvoicePreCheck(pdfData, part.filename);
        if (!preCheckPass) {
          if (send) await send({ type: "attachment_skipped", filename: part.filename, reason: "not_invoice_precheck" });
          continue;
        }

        const sanitizedFilename = part.filename.replace(/[^a-zA-Z0-9._-]/g, "_");
        const fileName = `${Date.now()}_${sanitizedFilename}`;
        const filePath = `invoices/${fileName}`;

        if (send) await send({ type: "uploading", filename: part.filename });

        const { error: uploadError } = await supabase.storage
          .from("documents")
          .upload(filePath, pdfData, { contentType: "application/pdf", upsert: true });

        if (uploadError) {
          warnings.push(`Błąd uploadu pliku ${part.filename}: ${uploadError.message}`);
          continue;
        }

        const { data: { publicUrl } } = supabase.storage.from("documents").getPublicUrl(filePath);
        const base64Content = uint8ToBase64(pdfData);

        const { data: invoiceData, error: insertError } = await supabase
          .from("invoices")
          .insert({
            file_url: publicUrl,
            pdf_base64: base64Content,
            uploaded_by: userId,
            source: "email",
            file_hash: job.force_reimport ? null : fileHash,
          })
          .select()
          .single();

        if (insertError) {
          if (insertError.message?.includes("idx_invoices_file_hash_per_user")) {
            warnings.push(`Pominięto załącznik z emaila - plik został już wcześniej dodany`);
          } else {
            warnings.push(`Nie udało się zapisać załącznika z emaila: ${insertError.message}`);
          }
          continue;
        }

        if (send) await send({ type: "invoice_created", filename: part.filename, invoiceId: invoiceData.id });

        let isRealInvoice = false;
        try {
          if (send) await send({ type: "ocr_start", filename: part.filename });

          const ocrResponse = await fetch(
            `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-invoice-ocr`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`,
                "Content-Type": "application/json",
              },
              body: JSON.stringify({ fileUrl: publicUrl, invoiceId: invoiceData.id }),
            }
          );

          if (ocrResponse.ok) {
            const ocrData = await ocrResponse.json();
            const d = ocrData.data || {};
            const clean = (v: unknown) => v && String(v).trim().length > 1 && v !== "null" && !String(v).startsWith("[");
            const hasInvoiceNumber = clean(d.invoice_number);
            const hasAmount = d.gross_amount && parseFloat(String(d.gross_amount)) > 0;
            const hasSupplierName = clean(d.supplier_name);
            const hasSupplierNip = clean(d.supplier_nip);
            const hasBuyerName = clean(d.buyer_name);
            const hasBuyerNip = clean(d.buyer_nip);
            const hasDate = clean(d.issue_date);
            const hasStrongSignal = !!(hasInvoiceNumber || hasBuyerNip || hasSupplierNip);
            const signals = [hasInvoiceNumber, hasAmount, hasSupplierName || hasSupplierNip, hasBuyerName || hasBuyerNip, hasDate].filter(Boolean).length;
            isRealInvoice = hasStrongSignal && signals >= 3;

            if (!isRealInvoice) {
              await supabase.from("invoices").delete().eq("id", invoiceData.id);
              await supabase.storage.from("documents").remove([filePath]);
              if (send) await send({ type: "attachment_skipped", filename: part.filename, reason: "not_invoice" });
            } else {
              if (ocrData.validationError) warnings.push(`${part.filename}: ${ocrData.validationError}`);
              if (send) await send({ type: "ocr_done", filename: part.filename });
            }
          } else {
            isRealInvoice = true;
          }
        } catch (ocrError) {
          isRealInvoice = true;
        }

        if (!isRealInvoice) continue;

        invoiceCount++;
        syncedCount++;

        const invoiceIdForDrive = invoiceData.id;
        const fileUrlForDrive = publicUrl;
        const fileNameForDrive = part.filename;
        const userIdForDrive = userId;
        const emailDateForDrive = emailDateIso;

        EdgeRuntime.waitUntil((async () => {
          try {
            await new Promise(r => setTimeout(r, 5000));
            let refreshedInvoice: any = null;
            for (let attempt = 0; attempt < 5; attempt++) {
              const { data } = await supabase.from("invoices").select("id, department_id, status, issue_date").eq("id", invoiceIdForDrive).maybeSingle();
              refreshedInvoice = data;
              if (refreshedInvoice?.department_id && refreshedInvoice?.issue_date) break;
              if (attempt < 4) await new Promise(r => setTimeout(r, 3000));
            }

            const deptId = refreshedInvoice?.department_id;
            const issueDate = refreshedInvoice?.issue_date || emailDateForDrive || null;
            let targetFolderId: string | null = null;

            if (deptId) {
              const { data: deptInfo } = await supabase.from("departments").select("name, google_drive_draft_folder_id").eq("id", deptId).maybeSingle();
              if (deptInfo?.google_drive_draft_folder_id) targetFolderId = deptInfo.google_drive_draft_folder_id;
            }

            if (!targetFolderId) {
              const { data: userDriveConfig } = await supabase.from("user_drive_configs").select("google_drive_folder_id, google_drive_folder_url").eq("user_id", userIdForDrive).eq("is_active", true).maybeSingle();
              if (userDriveConfig?.google_drive_folder_id) {
                targetFolderId = userDriveConfig.google_drive_folder_id;
              } else if (userDriveConfig?.google_drive_folder_url) {
                const urlMatch = userDriveConfig.google_drive_folder_url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                if (urlMatch) targetFolderId = urlMatch[1];
              }
            }

            if (!targetFolderId) {
              const { data: folderMappings } = await supabase.from("user_drive_folder_mappings").select("google_drive_folder_id, google_drive_folder_url").eq("user_id", userIdForDrive).eq("is_active", true).order("created_at", { ascending: false });
              if (folderMappings && folderMappings.length > 0) {
                const mapping = folderMappings[0];
                if (mapping.google_drive_folder_id) {
                  targetFolderId = mapping.google_drive_folder_id;
                } else if (mapping.google_drive_folder_url) {
                  const urlMatch = mapping.google_drive_folder_url.match(/\/folders\/([a-zA-Z0-9_-]+)/);
                  if (urlMatch) targetFolderId = urlMatch[1];
                }
              }
            }

            if (!targetFolderId) return;

            const uploadPayload: any = { fileUrl: fileUrlForDrive, fileName: fileNameForDrive, folderId: targetFolderId, mimeType: "application/pdf", originalMimeType: "application/pdf", userId: userIdForDrive, invoiceId: invoiceIdForDrive };
            if (issueDate) uploadPayload.issueDate = issueDate;

            await fetch(`${Deno.env.get("SUPABASE_URL")}/functions/v1/upload-to-google-drive`, {
              method: "POST",
              headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
              body: JSON.stringify(uploadPayload),
            });
          } catch (driveErr) {
            console.error("[email-sync] Drive upload error:", driveErr);
          }
        })());
      }

      if (!job.force_reimport) {
        await supabase.from("processed_email_messages").insert({
          email_config_id: config.id,
          message_uid: messageId,
          message_id: messageId,
          attachment_count: attachmentCount,
          invoice_count: invoiceCount,
        }).then(({ error: pErr }: { error: any }) => {
          if (pErr) console.error("Error marking message as processed:", pErr);
        });
      }
    } catch (msgError: any) {
      console.error("Error processing message:", msgError);
    }
  }

  return { processed: processedCount, synced: syncedCount, hasMore, nextPageToken: nextPageToken || undefined };
}

function collectPdfParts(payload: any): any[] {
  if (!payload) return [];
  const results: any[] = [];
  if (payload.filename?.toLowerCase().endsWith(".pdf") && payload.body?.attachmentId) {
    results.push(payload);
  }
  if (payload.parts && Array.isArray(payload.parts)) {
    for (const p of payload.parts) results.push(...collectPdfParts(p));
  }
  return results;
}

async function refreshAccessToken(supabase: any, config: EmailConfig): Promise<string> {
  const googleClientId = Deno.env.get("GOOGLE_CLIENT_ID");
  const googleClientSecret = Deno.env.get("GOOGLE_CLIENT_SECRET");
  if (!googleClientId || !googleClientSecret) throw new Error("Brak konfiguracji GOOGLE_CLIENT_ID / GOOGLE_CLIENT_SECRET");
  if (!config.oauth_refresh_token) throw new Error("Brak refresh tokena. Odłącz i połącz ponownie konto Google.");

  const tokenResponse = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: googleClientId, client_secret: googleClientSecret, refresh_token: config.oauth_refresh_token, grant_type: "refresh_token" }),
  });

  if (!tokenResponse.ok) {
    const errorBody = await tokenResponse.text();
    throw new Error(`Nie udało się odświeżyć tokena Google (${tokenResponse.status}). Odłącz i połącz ponownie konto.`);
  }

  const tokens = await tokenResponse.json();
  const expiryDate = new Date();
  expiryDate.setSeconds(expiryDate.getSeconds() + tokens.expires_in);

  await supabase.from("user_email_configs").update({ oauth_access_token: tokens.access_token, oauth_token_expiry: expiryDate.toISOString() }).eq("id", config.id);
  return tokens.access_token;
}

async function getValidAccessToken(supabase: any, config: EmailConfig): Promise<string> {
  if (!config.oauth_access_token || !config.oauth_token_expiry) return await refreshAccessToken(supabase, config);
  const expiryTime = new Date(config.oauth_token_expiry).getTime();
  if (isNaN(expiryTime) || Date.now() >= expiryTime - 5 * 60 * 1000) return await refreshAccessToken(supabase, config);
  return config.oauth_access_token;
}

async function quickInvoicePreCheck(pdfBytes: Uint8Array, filename: string): Promise<boolean> {
  try {
    const fnLower = filename.toLowerCase();

    const SKIP_PATTERNS = [
      "specyfikacja", "specification", "packing_list", "packing list", "waybill", "way_bill", "cmr",
      "bill_of_lading", "bill of lading", "delivery_note", "delivery note", "delivery_order", "delivery_confirmation",
      "listy_przewozowy", "list_przewozowy", "list przewozowy", "certyfikat", "certificate", "cert_", "_cert.",
      "newsletter", "brochure", "katalog", "catalog", "catalogue", "presentation", "prezentacja",
      "oferta_", "_oferta", "oferta.", "price_list", "cennik", "regulamin", "terms_and_conditions", "terms-and-conditions",
      "umowa", "contract", "agreement", "protokol", "protocol", "raport", "report", "zestawienie", "summary", "statement",
      "reklamacja", "complaint", "zamowienie", "order_confirmation", "order-confirmation",
      "potwierdzenie_zamowienia", "potwierdzenie_zam", "potwierdzenie",
    ];
    for (const pattern of SKIP_PATTERNS) {
      if (fnLower.includes(pattern)) return false;
    }

    const INVOICE_FILENAME_HINTS = [
      "faktura", "invoice", "facture", "rechnung", "fattura", "factura",
      "fakt_", "fakt.", "_fakt", "inv_", "inv.", "_inv", "fv_", "fv.", "_fv", "fac_", "fac.", "_fac", "proforma",
    ];
    for (const hint of INVOICE_FILENAME_HINTS) {
      if (fnLower.includes(hint)) return true;
    }

    try {
      const base64Content = uint8ToBase64(pdfBytes);
      const extractResp = await fetch(
        `${Deno.env.get("SUPABASE_URL")}/functions/v1/extract-pdf-text`,
        {
          method: "POST",
          headers: { Authorization: `Bearer ${Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")}`, "Content-Type": "application/json" },
          body: JSON.stringify({ pdf_base64: base64Content }),
        }
      );

      if (!extractResp.ok) return true;

      const { text } = await extractResp.json();
      if (!text || text.trim().length < 40) return true;

      const lowerText = text.toLowerCase();

      const OUR_COMPANY_NIPS = ["5851490834", "8222407812"];
      for (const nip of OUR_COMPANY_NIPS) {
        if (text.includes(nip)) {
          const nipIdx = text.indexOf(nip);
          const surrounding = text.substring(Math.max(0, nipIdx - 400), nipIdx + 50).toLowerCase();
          if (surrounding.includes("sprzedawca") || surrounding.includes("wystawil") || surrounding.includes("wystawiajacy") || nipIdx < 600) {
            return false;
          }
        }
      }
      if (lowerText.includes("vendo.erp") || lowerText.includes("www.cfi.pl")) return false;

      const DOCUMENT_TYPE_KEYWORDS = [
        "faktura", "invoice", "facture", "rechnung", "fattura", "factura",
        "rachun", "receipt", "reçu", "quittung", "ricevuta", "recibo",
        "nota księgowa", "nota korygująca", "credit note", "debit note",
        "nota debito", "nota credito", "avoir", "gutschrift",
        "proforma", "pro forma",
        "paragon fiskalny", "paragon",
      ];

      const hasDocumentTypeKeyword = DOCUMENT_TYPE_KEYWORDS.some(kw => lowerText.includes(kw));
      if (!hasDocumentTypeKeyword) return false;

      const STRONG_KEYWORDS = [
        "faktura vat", "faktura nr", "numer faktury", "nr faktury",
        "invoice number", "invoice no", "invoice #", "invoice nr",
        "rechnung nr", "rechnung number", "facture n°", "facture no",
      ];
      const SUPPORT_KEYWORDS = [
        "faktura", "invoice", "facture", "rechnung", "fattura", "factura",
        "nip", "tax id", "vat number", "vat no", "vat id",
        "sprzedawca", "nabywca", "seller", "buyer", "vendor", "bill to", "sold to",
        "kwota brutto", "kwota netto", "amount due", "total amount", "total net",
        "termin platnosci", "payment due", "payment terms", "due date",
        "netto", "brutto", "net amount", "gross amount",
      ];

      const hasStrongKeyword = STRONG_KEYWORDS.some(kw => lowerText.includes(kw));
      const supportFound = SUPPORT_KEYWORDS.filter(kw => lowerText.includes(kw));
      return hasStrongKeyword || supportFound.length >= 3;
    } catch {
      return true;
    }
  } catch (err: any) {
    console.error(`Pre-check error for "${filename}":`, err?.message);
    return true;
  }
}
