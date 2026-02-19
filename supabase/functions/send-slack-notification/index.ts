import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

interface NotificationPayload {
  user_id: string;
  title: string;
  message: string;
  type: string;
  notification_id: string;
}

function getTypeEmoji(type: string): string {
  switch (type) {
    case "new_invoice":
      return ":receipt:";
    case "status_change":
      return ":arrows_counterclockwise:";
    case "pending_review":
      return ":eyes:";
    case "new_contract":
      return ":page_facing_up:";
    case "contract_status_change":
      return ":memo:";
    default:
      return ":bell:";
  }
}

function getTypeLabel(type: string): string {
  switch (type) {
    case "new_invoice":
      return "Nowa faktura";
    case "status_change":
      return "Zmiana statusu faktury";
    case "pending_review":
      return "Oczekuje na przegląd";
    case "new_contract":
      return "Nowa umowa";
    case "contract_status_change":
      return "Zmiana statusu umowy";
    default:
      return "Powiadomienie";
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const url = new URL(req.url);

  if (url.pathname.endsWith("/test-connection")) {
    try {
      const { bot_token } = await req.json();

      if (!bot_token) {
        return new Response(
          JSON.stringify({ ok: false, error: "missing_token" }),
          {
            status: 400,
            headers: { ...corsHeaders, "Content-Type": "application/json" },
          }
        );
      }

      const response = await fetch("https://slack.com/api/auth.test", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${bot_token}`,
          "Content-Type": "application/json",
        },
      });

      const result = await response.json();

      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({ ok: false, error: error.message }),
        {
          status: 500,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }
  }

  try {
    const payload: NotificationPayload = await req.json();

    if (!payload.user_id || !payload.message) {
      return new Response(
        JSON.stringify({ error: "Missing required fields" }),
        {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const { data: slackConfig } = await supabase
      .from("slack_config")
      .select("bot_token, default_channel_id, enabled")
      .limit(1)
      .maybeSingle();

    if (!slackConfig?.enabled || !slackConfig?.bot_token) {
      return new Response(
        JSON.stringify({ message: "Slack not configured or disabled" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const { data: slackMapping } = await supabase
      .from("slack_user_mappings")
      .select("slack_user_id")
      .eq("user_id", payload.user_id)
      .maybeSingle();

    const targetChannel =
      slackMapping?.slack_user_id || slackConfig.default_channel_id;

    if (!targetChannel) {
      return new Response(
        JSON.stringify({ message: "No Slack target for user" }),
        {
          status: 200,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        }
      );
    }

    const emoji = getTypeEmoji(payload.type);
    const label = getTypeLabel(payload.type);

    let channelId = targetChannel;
    if (slackMapping?.slack_user_id) {
      const openDmResponse = await fetch("https://slack.com/api/conversations.open", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackConfig.bot_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ users: slackMapping.slack_user_id }),
      });
      const openDmResult = await openDmResponse.json();
      if (openDmResult.ok && openDmResult.channel?.id) {
        channelId = openDmResult.channel.id;
      }
    }

    const slackResponse = await fetch(
      "https://slack.com/api/chat.postMessage",
      {
        method: "POST",
        headers: {
          Authorization: `Bearer ${slackConfig.bot_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          channel: channelId,
          text: `${payload.title}: ${payload.message}`,
          blocks: [
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: `${emoji} *${payload.title}*`,
              },
            },
            {
              type: "section",
              text: {
                type: "mrkdwn",
                text: payload.message,
              },
            },
            {
              type: "context",
              elements: [
                {
                  type: "mrkdwn",
                  text: `_${label}_ | Aura DMS`,
                },
              ],
            },
          ],
        }),
      }
    );

    const slackResult = await slackResponse.json();

    return new Response(
      JSON.stringify({ ok: slackResult.ok, error: slackResult.error }),
      {
        status: slackResult.ok ? 200 : 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  } catch (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
