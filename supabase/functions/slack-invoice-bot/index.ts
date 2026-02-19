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
  if (!response.ok) throw new Error(`Failed to download file: ${response.status}`);
  const mimeType = response.headers.get("content-type") || "application/pdf";
  const buffer = await response.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 = btoa(binary);
  return { base64, mimeType: mimeType.split(";")[0].trim() };
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
  await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const body = await req.json();

    if (body.type === "url_verification") {
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

    const event = body.event;

    if (!event || event.subtype === "bot_message" || event.bot_id) {
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

    if (!slackConfig?.enabled || !slackConfig?.bot_token) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const token = slackConfig.bot_token;

    const slackUserId = event.user;
    if (!slackUserId) {
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const { data: userMapping } = await supabase
      .from("slack_user_mappings")
      .select("user_id")
      .eq("slack_user_id", slackUserId)
      .maybeSingle();

    const channelId = event.channel;

    if (event.type === "message" && event.files && event.files.length > 0) {
      if (!userMapping?.user_id) {
        await sendSlackMessage(token, channelId,
          "Nie rozpoznano Twojego konta. Skontaktuj się z administratorem, aby powiązać konto Slack z systemem.",
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      const userId = userMapping.user_id;
      const allowedMimeTypes = ["application/pdf", "image/jpeg", "image/jpg", "image/png"];
      const invoiceFiles = event.files.filter((f: { mimetype: string; size: number }) =>
        allowedMimeTypes.includes(f.mimetype) && f.size <= 10 * 1024 * 1024
      );

      if (invoiceFiles.length === 0) {
        await sendSlackMessage(token, channelId,
          ":x: Nieobsługiwany format pliku. Prześlij fakturę w formacie PDF, JPG lub PNG (maks. 10MB).",
        );
        return new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      await sendSlackMessage(token, channelId,
        `:hourglass: Otrzymano ${invoiceFiles.length} plik(i). Przetwarzam...`,
      );

      const results: { name: string; status: string; invoiceId?: string }[] = [];

      for (const file of invoiceFiles) {
        try {
          const { base64, mimeType } = await downloadSlackFile(
            file.url_private_download || file.url_private,
            token
          );

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

          const fileName = `slack_${Date.now()}_${file.name}`;
          const filePath = `invoices/${fileName}`;

          const binaryStr = atob(base64);
          const bytes = new Uint8Array(binaryStr.length);
          for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);

          const { error: storageError } = await supabase.storage
            .from("documents")
            .upload(filePath, bytes.buffer, { contentType: mimeType });

          if (storageError) throw storageError;

          const { data: { publicUrl } } = supabase.storage
            .from("documents")
            .getPublicUrl(filePath);

          const { data: invoiceData, error: insertError } = await supabase
            .from("invoices")
            .insert({
              file_url: publicUrl,
              pdf_base64: mimeType === "application/pdf" ? base64 : null,
              uploaded_by: userId,
              file_hash: hash,
              source: "manual",
              status: "draft",
              description: event.text ? `Slack: ${event.text.substring(0, 200)}` : "Przesłano przez Slack",
            })
            .select()
            .single();

          if (insertError) throw insertError;

          EdgeRuntime.waitUntil((async () => {
            try {
              const supabaseInternal = createClient(
                Deno.env.get("SUPABASE_URL")!,
                Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
              );

              const ocrUrl = `${Deno.env.get("SUPABASE_URL")}/functions/v1/process-invoice-ocr`;
              await fetch(ocrUrl, {
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

              const { data: updatedInvoice } = await supabaseInternal
                .from("invoices")
                .select("invoice_number, supplier_name, gross_amount, currency")
                .eq("id", invoiceData.id)
                .maybeSingle();

              if (updatedInvoice) {
                const parts = [];
                if (updatedInvoice.supplier_name) parts.push(`*Dostawca:* ${updatedInvoice.supplier_name}`);
                if (updatedInvoice.invoice_number) parts.push(`*Nr faktury:* ${updatedInvoice.invoice_number}`);
                if (updatedInvoice.gross_amount) parts.push(`*Kwota brutto:* ${updatedInvoice.gross_amount} ${updatedInvoice.currency || "PLN"}`);

                if (parts.length > 0) {
                  await sendSlackMessage(token, channelId,
                    `:white_check_mark: OCR zakończony dla pliku *${file.name}*:\n${parts.join("\n")}`
                  );
                }
              }
            } catch (_ocrErr) {
            }
          })());

          results.push({ name: file.name, status: "ok", invoiceId: invoiceData.id });
        } catch (err) {
          results.push({ name: file.name, status: `error:${err.message}` });
        }
      }

      const okCount = results.filter(r => r.status === "ok").length;
      const dupCount = results.filter(r => r.status.startsWith("duplicate")).length;
      const errCount = results.filter(r => r.status.startsWith("error")).length;

      const blocks = [
        {
          type: "section",
          text: {
            type: "mrkdwn",
            text: `:receipt: *Wynik przesyłania faktur*`,
          },
        },
        {
          type: "section",
          fields: [
            { type: "mrkdwn", text: `:white_check_mark: *Dodano:* ${okCount}` },
            { type: "mrkdwn", text: `:warning: *Duplikaty:* ${dupCount}` },
            { type: "mrkdwn", text: `:x: *Błędy:* ${errCount}` },
          ],
        },
      ];

      for (const r of results) {
        if (r.status.startsWith("duplicate")) {
          const label = r.status.split(":")[1];
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:warning: *${r.name}* — plik już istnieje w systemie jako: _${label}_`,
            },
          });
        } else if (r.status.startsWith("error")) {
          const msg = r.status.replace("error:", "");
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:x: *${r.name}* — błąd: ${msg}`,
            },
          });
        } else {
          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:white_check_mark: *${r.name}* — dodano do systemu, OCR w toku...`,
            },
          });
        }
      }

      blocks.push({
        type: "context",
        elements: [{ type: "mrkdwn", text: `_Aura DMS_ | Faktura w statusie: Szkic` }],
      });

      await sendSlackMessage(token, channelId, "Wynik przesyłania faktur", blocks);

      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    if (event.type === "message" && !event.files) {
      const text = (event.text || "").toLowerCase().trim();

      if (text === "pomoc" || text === "help" || text === "/pomoc") {
        await sendSlackMessage(token, channelId, "Jak dodać fakturę?", [
          {
            type: "section",
            text: {
              type: "mrkdwn",
              text: `:receipt: *Jak dodać fakturę przez Slack?*\n\nWyślij mi plik faktury (PDF, JPG lub PNG) w tej wiadomości.\n\n• Plik zostanie automatycznie dodany do systemu Aura DMS\n• OCR odczyta dane faktury\n• Faktura pojawi się w panelu w statusie _Szkic_\n\n:information_source: Obsługiwane formaty: PDF, JPG, PNG (maks. 10MB)`,
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
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
