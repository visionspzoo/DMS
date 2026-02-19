import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function downloadSlackFile(url: string, token: string): Promise<{ base64: string; mimeType: string }> {
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!response.ok) {
    const body = await response.text();
    throw new Error(`Failed to download Slack file (${response.status}): ${body}`);
  }
  const contentType = response.headers.get("content-type") || "application/octet-stream";
  const mimeType = contentType.split(";")[0].trim();
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  const chunkSize = 8192;
  for (let i = 0; i < bytes.byteLength; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }
  return { base64: btoa(binary), mimeType };
}

async function getSlackFileInfo(fileId: string, token: string): Promise<{ url: string; mimeType: string; name: string; size: number } | null> {
  const resp = await fetch(`https://slack.com/api/files.info?file=${fileId}`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const data = await resp.json();
  if (!data.ok || !data.file) return null;
  const f = data.file;
  const mimeType = f.mimetype || "application/octet-stream";
  const url = f.url_private_download || f.url_private;
  return { url, mimeType, name: f.name || fileId, size: f.size || 0 };
}

async function computeHash(base64: string): Promise<string> {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const hashBuffer = await crypto.subtle.digest("SHA-256", bytes);
  return Array.from(new Uint8Array(hashBuffer)).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function sendSlackMessage(token: string, channel: string, text: string, blocks?: unknown[]) {
  const body: Record<string, unknown> = { channel, text };
  if (blocks) body.blocks = blocks;
  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const result = await resp.json();
  if (!result.ok) {
    console.error("[slack-invoice-bot] sendSlackMessage error:", result.error);
  }
}

const ALLOWED_MIME_TYPES = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
const MAX_FILE_SIZE = 10 * 1024 * 1024;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let body: Record<string, unknown>;
    const contentType = req.headers.get("content-type") || "";

    if (contentType.includes("application/x-www-form-urlencoded")) {
      const text = await req.text();
      const params = new URLSearchParams(text);
      const payloadStr = params.get("payload");
      if (payloadStr) {
        body = JSON.parse(payloadStr);
      } else {
        body = Object.fromEntries(params.entries());
      }
    } else {
      const text = await req.text();
      console.log("[slack-invoice-bot] RAW BODY:", text.substring(0, 1000));
      body = JSON.parse(text);
    }

    console.log("[slack-invoice-bot] Event type:", body.type, "| Event:", JSON.stringify(body.event || {}).substring(0, 500));

    if (body.type === "url_verification") {
      console.log("[slack-invoice-bot] URL verification challenge");
      return new Response(JSON.stringify({ challenge: body.challenge }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (body.type !== "event_callback") {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const event = body.event as Record<string, unknown>;
    if (!event) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if ((event.subtype as string) === "bot_message" || event.bot_id) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: slackConfig } = await supabase
      .from("slack_config")
      .select("bot_token, enabled")
      .limit(1)
      .maybeSingle();

    console.log("[slack-invoice-bot] Config found:", !!slackConfig, "enabled:", slackConfig?.enabled);

    if (!slackConfig?.enabled || !slackConfig?.bot_token) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = slackConfig.bot_token as string;
    const slackUserId = event.user as string;
    const channelId = event.channel as string;

    if (!slackUserId) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log("[slack-invoice-bot] From user:", slackUserId, "channel:", channelId);
    console.log("[slack-invoice-bot] Event subtype:", event.subtype, "files:", JSON.stringify(event.files || []).substring(0, 200));

    const { data: userMapping } = await supabase
      .from("slack_user_mappings")
      .select("user_id")
      .eq("slack_user_id", slackUserId)
      .maybeSingle();

    console.log("[slack-invoice-bot] User mapping found:", !!userMapping);

    const eventType = event.type as string;
    const eventSubtype = event.subtype as string | undefined;

    const hasFiles = Array.isArray(event.files) && (event.files as unknown[]).length > 0;
    const isFileShareEvent = eventType === "message" && (eventSubtype === "file_share" || hasFiles);
    const isFileSharedEvent = eventType === "file_shared";

    if (isFileSharedEvent || isFileShareEvent) {
      if (!userMapping?.user_id) {
        await sendSlackMessage(token, channelId,
          "Nie rozpoznano Twojego konta. Skontaktuj sie z administratorem, aby powiazac konto Slack z systemem.",
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = userMapping.user_id as string;

      let filesToProcess: { url: string; mimeType: string; name: string; size: number }[] = [];

      if (isFileSharedEvent) {
        const fileId = event.file_id as string || (event.file as Record<string, unknown>)?.id as string;
        if (fileId) {
          const info = await getSlackFileInfo(fileId, token);
          if (info) filesToProcess.push(info);
        }
      } else if (hasFiles) {
        const rawFiles = event.files as Record<string, unknown>[];
        for (const f of rawFiles) {
          const fileId = f.id as string;
          if (!fileId) continue;
          const info = await getSlackFileInfo(fileId, token);
          if (info) filesToProcess.push(info);
        }
      }

      console.log("[slack-invoice-bot] Files to process:", filesToProcess.length, JSON.stringify(filesToProcess.map(f => ({ name: f.name, mimeType: f.mimeType, size: f.size }))));

      const invoiceFiles = filesToProcess.filter(f =>
        ALLOWED_MIME_TYPES.includes(f.mimeType) && f.size <= MAX_FILE_SIZE
      );

      if (invoiceFiles.length === 0 && filesToProcess.length > 0) {
        await sendSlackMessage(token, channelId,
          ":x: Nieobslugiwany format pliku. Przeslij fakture w formacie PDF, JPG lub PNG (maks. 10MB).",
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      if (invoiceFiles.length === 0) {
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await sendSlackMessage(token, channelId,
        `:hourglass_flowing_sand: Otrzymano ${invoiceFiles.length} plik(i). Przetwarzam...`,
      );

      const results: { name: string; status: string; invoiceId?: string }[] = [];

      for (const file of invoiceFiles) {
        try {
          console.log("[slack-invoice-bot] Downloading file:", file.name, file.url.substring(0, 80));
          const { base64, mimeType } = await downloadSlackFile(file.url, token);
          console.log("[slack-invoice-bot] Downloaded, base64 length:", base64.length);

          const hash = await computeHash(base64);

          const { data: existingInvoice } = await supabase
            .from("invoices")
            .select("id, invoice_number, supplier_name")
            .eq("file_hash", hash)
            .maybeSingle();

          if (existingInvoice) {
            const label = existingInvoice.invoice_number || existingInvoice.supplier_name || existingInvoice.id;
            results.push({ name: file.name, status: `duplicate:${label}` });
            continue;
          }

          const fileName = `slack_${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, "_")}`;
          const filePath = `invoices/${fileName}`;

          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          const { error: storageError } = await supabase.storage
            .from("documents")
            .upload(filePath, bytes.buffer, { contentType: mimeType });

          if (storageError) throw new Error(`Storage upload failed: ${storageError.message}`);

          const { data: { publicUrl } } = supabase.storage
            .from("documents")
            .getPublicUrl(filePath);

          const description = (event.text as string) ? `Slack: ${(event.text as string).substring(0, 200)}` : "Przeslano przez Slack";

          const { data: invoiceData, error: insertError } = await supabase
            .from("invoices")
            .insert({
              file_url: publicUrl,
              pdf_base64: mimeType === "application/pdf" ? base64 : null,
              uploaded_by: userId,
              file_hash: hash,
              source: "manual",
              status: "draft",
              description,
            })
            .select()
            .single();

          if (insertError) {
            if (insertError.code === "23505") {
              results.push({ name: file.name, status: "duplicate:plik juz istnieje" });
              continue;
            }
            throw new Error(`DB insert failed: ${insertError.message}`);
          }

          console.log("[slack-invoice-bot] Invoice created:", invoiceData.id);
          results.push({ name: file.name, status: "ok", invoiceId: invoiceData.id });

          EdgeRuntime.waitUntil((async () => {
            try {
              const ocrUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-invoice-ocr`;
              const ocrResp = await fetch(ocrUrl, {
                method: "POST",
                headers: {
                  "Authorization": `Bearer ${Deno.env.get("SUPABASE_ANON_KEY")}`,
                  "Content-Type": "application/json",
                  "apikey": Deno.env.get("SUPABASE_ANON_KEY")!,
                },
                body: JSON.stringify({
                  fileUrl: publicUrl,
                  invoiceId: invoiceData.id,
                  mimeType,
                  fileBase64: base64,
                }),
              });
              console.log("[slack-invoice-bot] OCR response status:", ocrResp.status);

              if (ocrResp.ok) {
                const supabaseInternal = createClient(
                  Deno.env.get("SUPABASE_URL")!,
                  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
                );
                await new Promise(r => setTimeout(r, 3000));
                const { data: updated } = await supabaseInternal
                  .from("invoices")
                  .select("invoice_number, supplier_name, gross_amount, currency")
                  .eq("id", invoiceData.id)
                  .maybeSingle();

                if (updated && (updated.supplier_name || updated.invoice_number)) {
                  const parts: string[] = [];
                  if (updated.supplier_name) parts.push(`*Dostawca:* ${updated.supplier_name}`);
                  if (updated.invoice_number) parts.push(`*Nr faktury:* ${updated.invoice_number}`);
                  if (updated.gross_amount) parts.push(`*Kwota brutto:* ${updated.gross_amount} ${updated.currency || "PLN"}`);

                  await sendSlackMessage(token, channelId,
                    `:white_check_mark: OCR zakończony dla *${file.name}*:\n${parts.join("\n")}`,
                  );
                }
              }
            } catch (ocrErr) {
              console.error("[slack-invoice-bot] OCR background error:", ocrErr);
            }
          })());

        } catch (err) {
          console.error("[slack-invoice-bot] Error processing file:", file.name, err);
          results.push({ name: file.name, status: `error:${err.message}` });
        }
      }

      const okCount = results.filter(r => r.status === "ok").length;
      const dupCount = results.filter(r => r.status.startsWith("duplicate")).length;
      const errCount = results.filter(r => r.status.startsWith("error")).length;

      console.log("[slack-invoice-bot] Results:", { okCount, dupCount, errCount });

      const blocks: unknown[] = [
        {
          type: "section",
          text: { type: "mrkdwn", text: `:receipt: *Wynik przesylania faktur*` },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `:white_check_mark: *Dodano:* ${okCount}` },
            { type: "mrkdwn", text: `:warning: *Duplikaty:* ${dupCount}` },
            { type: "mrkdwn", text: `:x: *Bledy:* ${errCount}` },
          ],
        },
      ];

      for (const r of results) {
        if (r.status.startsWith("duplicate")) {
          const label = r.status.replace("duplicate:", "");
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `:warning: *${r.name}* — plik juz istnieje w systemie: _${label}_` },
          });
        } else if (r.status.startsWith("error")) {
          const msg = r.status.replace("error:", "");
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `:x: *${r.name}* — blad: ${msg}` },
          });
        } else {
          blocks.push({
            type: "section",
            text: { type: "mrkdwn", text: `:white_check_mark: *${r.name}* — dodano do systemu, OCR w toku...` },
          });
        }
      }

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_Aura DMS_ | Faktura w statusie: Szkic` }],
      });

      await sendSlackMessage(token, channelId, "Wynik przesylania faktur", blocks);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (eventType === "message" && !hasFiles && !eventSubtype) {
      const text = ((event.text as string) || "").toLowerCase().trim();
      if (text === "pomoc" || text === "help") {
        await sendSlackMessage(token, channelId, "Jak dodac fakture?", [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:receipt: *Jak dodac fakture przez Slack?*\n\nWyslij mi plik faktury (PDF, JPG lub PNG) w tej wiadomosci.\n\n• Plik zostanie automatycznie dodany do systemu Aura DMS\n• OCR odczyta dane faktury\n• Faktura pojawi sie w panelu w statusie _Szkic_\n\n:information_source: Obslugiwane formaty: PDF, JPG, PNG (maks. 10MB)`,
            },
          },
        ]);
      }
    }

    return new Response(JSON.stringify({ ok: true }), {
      status: 200,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });

  } catch (error) {
    console.error("[slack-invoice-bot] Unhandled error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
