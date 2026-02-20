import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

async function openDmChannel(botToken: string, slackUserId: string): Promise<string | null> {
  const resp = await fetch("https://slack.com/api/conversations.open", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ users: slackUserId }),
  });
  const data = await resp.json();
  return data.ok && data.channel?.id ? data.channel.id : null;
}

async function sendSlackBlocks(botToken: string, channelId: string, text: string, blocks: unknown[]) {
  const resp = await fetch("https://slack.com/api/chat.postMessage", {
    method: "POST",
    headers: { Authorization: `Bearer ${botToken}`, "Content-Type": "application/json" },
    body: JSON.stringify({ channel: channelId, text, blocks }),
  });
  const result = await resp.json();
  if (!result.ok) {
    console.error("[midnight-summary] Slack error:", result.error, "channel:", channelId);
  }
  return result.ok;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    let isManual = false;
    if (req.method === "POST") {
      try {
        const body = await req.json();
        isManual = body?.manual === true;
      } catch (_) {}
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
      console.log("[midnight-summary] Slack not configured or disabled");
      return new Response(JSON.stringify({ ok: true, message: "Slack disabled" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const botToken = slackConfig.bot_token as string;

    const { data: mappings } = await supabase
      .from("slack_user_mappings")
      .select("user_id, slack_user_id");

    if (!mappings || mappings.length === 0) {
      console.log("[midnight-summary] No Slack user mappings found");
      return new Response(JSON.stringify({ ok: true, message: "No mappings" }), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    console.log(`[midnight-summary] Processing ${mappings.length} users`);

    const sentCount: number[] = [];

    for (const mapping of mappings) {
      const userId = mapping.user_id as string;
      const slackUserId = mapping.slack_user_id as string;

      const { data: pendingInvoices } = await supabase
        .from("invoices")
        .select("id, invoice_number, supplier_name, gross_amount, currency, created_at, department_id")
        .eq("status", "waiting")
        .eq("current_approver_id", userId)
        .order("created_at", { ascending: true });

      const { data: rejectedInvoices } = await supabase
        .from("invoices")
        .select("id, invoice_number, supplier_name, gross_amount, currency, created_at, department_id")
        .eq("status", "draft")
        .eq("uploaded_by", userId)
        .not("current_approver_id", "is", null)
        .order("created_at", { ascending: false })
        .limit(20);

      const pending = pendingInvoices || [];
      const rejected = rejectedInvoices || [];

      if (pending.length === 0 && rejected.length === 0) {
        console.log(`[midnight-summary] User ${userId} has no pending/rejected invoices, skipping`);
        continue;
      }

      const dmChannelId = await openDmChannel(botToken, slackUserId);
      if (!dmChannelId) {
        console.error(`[midnight-summary] Could not open DM for slack user ${slackUserId}`);
        continue;
      }

      const blocks: unknown[] = [
        {
          type: "header",
          text: { type: "plain_text", text: isManual ? "Podsumowanie faktur (wyslane recznie) — Aura DMS" : "Podsumowanie faktur — Aura DMS", emoji: true },
        },
        {
          type: "context",
          elements: [{ type: "mrkdwn", text: isManual ? `_Reczne podsumowanie z dnia ${new Date().toLocaleDateString("pl-PL")} ${new Date().toLocaleTimeString("pl-PL", { hour: "2-digit", minute: "2-digit" })}_` : `_Codzienne podsumowanie z dnia ${new Date().toLocaleDateString("pl-PL")}_` }],
        },
        { type: "divider" },
      ];

      if (pending.length > 0) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `:eyes: *Oczekuje na Twoją weryfikację: ${pending.length}*` },
        });

        for (const inv of pending.slice(0, 10)) {
          const supplier = inv.supplier_name || "_Brak nazwy dostawcy_";
          const number = inv.invoice_number ? `nr ${inv.invoice_number}` : "nr nieznany";
          const amount = inv.gross_amount
            ? `${Number(inv.gross_amount).toLocaleString("pl-PL", { minimumFractionDigits: 2 })} ${inv.currency || "PLN"}`
            : "kwota nieznana";
          const date = new Date(inv.created_at).toLocaleDateString("pl-PL");

          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `• *${supplier}* — ${number}\n  Kwota: ${amount} | Dodano: ${date}`,
            },
          });
        }

        if (pending.length > 10) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `_...i jeszcze ${pending.length - 10} faktur do zweryfikowania_` }],
          });
        }

        blocks.push({ type: "divider" });
      }

      if (rejected.length > 0) {
        blocks.push({
          type: "section",
          text: { type: "mrkdwn", text: `:warning: *Faktury zwrócone do poprawy: ${rejected.length}*` },
        });

        for (const inv of rejected.slice(0, 10)) {
          const supplier = inv.supplier_name || "_Brak nazwy dostawcy_";
          const number = inv.invoice_number ? `nr ${inv.invoice_number}` : "nr nieznany";
          const amount = inv.gross_amount
            ? `${Number(inv.gross_amount).toLocaleString("pl-PL", { minimumFractionDigits: 2 })} ${inv.currency || "PLN"}`
            : "kwota nieznana";
          const date = new Date(inv.created_at).toLocaleDateString("pl-PL");

          blocks.push({
            type: "section",
            text: {
              type: "mrkdwn",
              text: `• *${supplier}* — ${number}\n  Kwota: ${amount} | Dodano: ${date}`,
            },
          });
        }

        if (rejected.length > 10) {
          blocks.push({
            type: "context",
            elements: [{ type: "mrkdwn", text: `_...i jeszcze ${rejected.length - 10} faktur do poprawy_` }],
          });
        }

        blocks.push({ type: "divider" });
      }

      blocks.push({
        type: "section",
        text: {
          type: "mrkdwn",
          text: ":point_right: Zaloguj sie do systemu Aura DMS, aby przetworzyc faktury.",
        },
      });

      const summaryParts: string[] = [];
      if (pending.length > 0) summaryParts.push(`${pending.length} do weryfikacji`);
      if (rejected.length > 0) summaryParts.push(`${rejected.length} zwroconych`);
      const fallbackText = `Aura DMS: masz ${summaryParts.join(" i ")}`;

      const sent = await sendSlackBlocks(botToken, dmChannelId, fallbackText, blocks);
      if (sent) sentCount.push(1);

      console.log(`[midnight-summary] Sent to ${slackUserId}: pending=${pending.length}, rejected=${rejected.length}`);
    }

    return new Response(
      JSON.stringify({ ok: true, users_notified: sentCount.length }),
      {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    console.error("[midnight-summary] Error:", error);
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
