import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function clickupAuthHeader(token: string): string {
  return token.startsWith("pk_") ? token : `Bearer ${token}`;
}

function getAppFieldValue(request: Record<string, any>, appField: string): string | number | null {
  const fieldMap: Record<string, () => string | number | null> = {
    description: () => request.description || null,
    gross_amount: () => request.gross_amount ?? null,
    quantity: () => request.quantity ?? null,
    delivery_location: () => request.delivery_location || null,
    priority: () => request.priority || null,
    link: () => request.link || null,
    submitter_name: () => request.submitter?.full_name || null,
    submitter_email: () => request.submitter?.email || null,
    department_name: () => request.department?.name || null,
    proforma_filename: () => request.proforma_filename || null,
    bez_mpk: () => (request.bez_mpk ? "Tak" : "Nie"),
    created_at: () => request.created_at ? new Date(request.created_at).toLocaleString("pl-PL") : null,
    id: () => request.id || null,
  };
  return fieldMap[appField]?.() ?? null;
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
    );

    const body = await req.json();

    const { data: config, error: configError } = await supabase
      .from("clickup_config")
      .select("*")
      .limit(1)
      .maybeSingle();

    if (configError) throw new Error(`Config error: ${configError.message}`);

    if (body.action === "register_webhook") {
      const token = body.api_token || config?.api_token;
      if (!token) throw new Error("Brak tokenu API ClickUp");

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookEndpoint = `${supabaseUrl}/functions/v1/clickup-webhook`;

      const teamRes = await fetch("https://api.clickup.com/api/v2/team", {
        headers: { Authorization: clickupAuthHeader(token) },
      });
      if (!teamRes.ok) throw new Error(`Blad pobierania workspace: HTTP ${teamRes.status}`);
      const teamData = await teamRes.json();
      const teamId = teamData.teams?.[0]?.id;
      if (!teamId) throw new Error("Nie znaleziono workspace w ClickUp");

      if (config?.clickup_webhook_id) {
        const checkRes = await fetch(
          `https://api.clickup.com/api/v2/team/${teamId}/webhook`,
          { headers: { Authorization: clickupAuthHeader(token) } }
        );
        if (checkRes.ok) {
          const checkData = await checkRes.json();
          const existing = (checkData.webhooks || []).find(
            (w: any) => w.id === config.clickup_webhook_id
          );
          if (existing) {
            return new Response(
              JSON.stringify({ success: true, webhook_id: existing.id, endpoint: existing.endpoint, already_exists: true }),
              { headers: { ...corsHeaders, "Content-Type": "application/json" } }
            );
          }
        }
      }

      const createWebhookRes = await fetch(
        `https://api.clickup.com/api/v2/team/${teamId}/webhook`,
        {
          method: "POST",
          headers: {
            Authorization: clickupAuthHeader(token),
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            endpoint: webhookEndpoint,
            events: ["taskStatusUpdated"],
          }),
        }
      );

      if (!createWebhookRes.ok) {
        const errData = await createWebhookRes.json().catch(() => ({}));
        throw new Error(errData.err || errData.error || `Blad rejestracji webhooka: HTTP ${createWebhookRes.status}`);
      }

      const webhookData = await createWebhookRes.json();
      const webhookId = webhookData.webhook?.id || webhookData.id;

      await supabase
        .from("clickup_config")
        .update({ clickup_webhook_id: webhookId })
        .eq("id", config!.id);

      return new Response(
        JSON.stringify({ success: true, webhook_id: webhookId, endpoint: webhookEndpoint }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.action === "check_webhook") {
      const token = body.api_token || config?.api_token;
      if (!token) throw new Error("Brak tokenu API ClickUp");

      const teamRes = await fetch("https://api.clickup.com/api/v2/team", {
        headers: { Authorization: clickupAuthHeader(token) },
      });
      if (!teamRes.ok) throw new Error(`Blad pobierania workspace: HTTP ${teamRes.status}`);
      const teamData = await teamRes.json();
      const teamId = teamData.teams?.[0]?.id;
      if (!teamId) throw new Error("Nie znaleziono workspace w ClickUp");

      const webhooksRes = await fetch(
        `https://api.clickup.com/api/v2/team/${teamId}/webhook`,
        { headers: { Authorization: clickupAuthHeader(token) } }
      );
      if (!webhooksRes.ok) throw new Error(`Blad pobierania webhookow: HTTP ${webhooksRes.status}`);
      const webhooksData = await webhooksRes.json();

      const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
      const webhookEndpoint = `${supabaseUrl}/functions/v1/clickup-webhook`;
      const registered = (webhooksData.webhooks || []).find(
        (w: any) => w.endpoint === webhookEndpoint || w.id === config?.clickup_webhook_id
      );

      if (registered && (!config?.clickup_webhook_id || config.clickup_webhook_id !== registered.id)) {
        await supabase
          .from("clickup_config")
          .update({ clickup_webhook_id: registered.id })
          .eq("id", config!.id);
      }

      return new Response(
        JSON.stringify({
          success: true,
          registered: !!registered,
          webhook_id: registered?.id || null,
          endpoint: registered?.endpoint || null,
          all_webhooks: webhooksData.webhooks?.length || 0,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.action === "delete_webhook") {
      const token = body.api_token || config?.api_token;
      const webhookId = body.webhook_id || config?.clickup_webhook_id;
      if (!token) throw new Error("Brak tokenu API ClickUp");
      if (!webhookId) throw new Error("Brak ID webhooka do usuniecia");

      const delRes = await fetch(
        `https://api.clickup.com/api/v2/webhook/${webhookId}`,
        {
          method: "DELETE",
          headers: { Authorization: clickupAuthHeader(token) },
        }
      );

      if (!delRes.ok && delRes.status !== 404) {
        throw new Error(`Blad usuwania webhooka: HTTP ${delRes.status}`);
      }

      await supabase
        .from("clickup_config")
        .update({ clickup_webhook_id: null })
        .eq("id", config!.id);

      return new Response(
        JSON.stringify({ success: true }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.action === "test_connection") {
      const tokenToTest = body.api_token || config?.api_token;
      if (!tokenToTest) {
        throw new Error("Brak tokenu API ClickUp - wprowadz token w formularzu");
      }
      const testRes = await fetch("https://api.clickup.com/api/v2/user", {
        headers: { Authorization: clickupAuthHeader(tokenToTest) },
      });
      if (!testRes.ok) {
        const rawText = await testRes.text().catch(() => "");
        let errMsg = `HTTP ${testRes.status}`;
        try {
          const errJson = JSON.parse(rawText);
          errMsg = errJson.err || errJson.error || errJson.message || errMsg;
        } catch (_) {}
        throw new Error(`ClickUp API: ${errMsg}`);
      }
      const userData = await testRes.json();
      return new Response(
        JSON.stringify({ success: true, workspace: userData.user?.username, email: userData.user?.email }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (body.action === "fetch_list_fields") {
      const token = body.api_token || config?.api_token;
      const listId = body.list_id || config?.list_id;
      if (!token || !listId) throw new Error("Brak tokenu lub ID listy");

      const cleanToken = token.trim();
      const fieldsRes = await fetch(`https://api.clickup.com/api/v2/list/${listId}/field`, {
        headers: { Authorization: clickupAuthHeader(cleanToken) },
      });
      if (!fieldsRes.ok) {
        const rawText = await fieldsRes.text().catch(() => "");
        let errMsg = `HTTP ${fieldsRes.status}`;
        try {
          const errJson = JSON.parse(rawText);
          errMsg = errJson.err || errJson.error || errJson.message || errMsg;
        } catch (_) {}
        throw new Error(`ClickUp API: ${errMsg} (lista: ${listId}, token prefix: ${cleanToken.substring(0, 8)}...)`);
      }
      const fieldsData = await fieldsRes.json();
      const fields = (fieldsData.fields || []).map((f: any) => ({
        id: f.id,
        name: f.name,
        type: f.type,
        type_config: f.type_config,
      }));

      await supabase
        .from("clickup_config")
        .update({ cached_custom_fields: fields })
        .eq("id", config?.id);

      return new Response(
        JSON.stringify({ success: true, fields }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { purchase_request_id } = body;
    if (!purchase_request_id) throw new Error("Brak purchase_request_id");

    if (!config?.enabled) {
      return new Response(
        JSON.stringify({ success: false, message: "Integracja ClickUp jest wylaczona" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!config.api_token || !config.list_id) {
      throw new Error("Niekompletna konfiguracja ClickUp (brak tokenu lub ID listy)");
    }

    const { data: requestRaw, error: reqError } = await supabase
      .from("purchase_requests")
      .select("*")
      .eq("id", purchase_request_id)
      .maybeSingle();

    if (reqError) throw new Error(`Request error: ${reqError.message}`);
    if (!requestRaw) throw new Error("Wniosek zakupowy nie znaleziony");

    const [profileRes, deptRes] = await Promise.all([
      requestRaw.user_id
        ? supabase.from("profiles").select("full_name, email").eq("id", requestRaw.user_id).maybeSingle()
        : Promise.resolve({ data: null }),
      requestRaw.department_id
        ? supabase.from("departments").select("name").eq("id", requestRaw.department_id).maybeSingle()
        : Promise.resolve({ data: null }),
    ]);

    const request = {
      ...requestRaw,
      submitter: profileRes.data || null,
      department: deptRes.data || null,
    };

    if (request.proforma_pdf_base64) {
      return new Response(
        JSON.stringify({ success: false, message: "Proformy nie tworza zadan w ClickUp - uzywaj API wnioskow zakupowych" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (request.clickup_task_id) {
      return new Response(
        JSON.stringify({ success: true, task_id: request.clickup_task_id, message: "Zadanie juz istnieje w ClickUp" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const priorityMap: Record<string, number> = {
      pilny: 1,
      urgent: 1,
      wysoki: 2,
      high: 2,
      normalny: 3,
      normal: 3,
      niski: 4,
      low: 4,
    };

    const submitterName = request.submitter?.full_name || "Nieznany uzytkownik";
    const submitterEmail = request.submitter?.email || "";
    const departmentName = request.department?.name || "Brak dzialu";
    const priorityClickUp = priorityMap[request.priority?.toLowerCase()] ?? 3;

    const { data: standardMappings } = await supabase
      .from("clickup_standard_field_mappings")
      .select("*")
      .eq("enabled", true)
      .order("sort_order");

    const nameMappings = (standardMappings || []).filter((m: any) => m.field_target === "name");
    const descMappings = (standardMappings || []).filter((m: any) => m.field_target === "description");

    let taskName: string;
    if (nameMappings.length > 0) {
      const nameParts = nameMappings
        .map((m: any) => getAppFieldValue(request, m.app_field))
        .filter(Boolean);
      taskName = nameParts.join(" - ") || `Wniosek zakupowy: ${request.description?.slice(0, 80) || "Bez opisu"}`;
    } else {
      taskName = `Wniosek zakupowy: ${request.description?.slice(0, 80) || "Bez opisu"}`;
    }

    const APP_FIELD_LABELS: Record<string, string> = {
      description: "Opis:",
      gross_amount: "Kwota brutto:",
      quantity: "Ilosc:",
      delivery_location: "Miejsce dostawy:",
      priority: "Priorytet:",
      link: "Link do produktu:",
      submitter_name: "Wnioskodawca:",
      submitter_email: "Email zamawiajacego:",
      department_name: "Dzial:",
      proforma_filename: "Proforma:",
      bez_mpk: "Bez MPK:",
      created_at: "Data zlozenia:",
      id: "ID wniosku:",
    };

    let taskDescription: string;
    if (descMappings.length > 0) {
      const descLines = descMappings
        .map((m: any) => {
          const value = getAppFieldValue(request, m.app_field);
          if (value === null || value === undefined || value === "") return null;
          const label = m.label || APP_FIELD_LABELS[m.app_field] || m.app_field;
          return `**${label}** ${value}`;
        })
        .filter(Boolean);
      taskDescription = descLines.join("\n");
    } else {
      const amountFormatted = request.gross_amount
        ? new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(request.gross_amount)
        : "Brak kwoty";
      taskDescription = [
        `**Wnioskodawca:** ${submitterName}`,
        `**Email zamawiajacego:** ${submitterEmail}`,
        `**Dzial:** ${departmentName}`,
        `**Opis:** ${request.description || "Brak opisu"}`,
        `**Kwota brutto:** ${amountFormatted}`,
        `**Ilosc:** ${request.quantity ?? 1} szt.`,
        `**Miejsce dostawy:** ${request.delivery_location || "Nie podano"}`,
        `**Priorytet:** ${request.priority || "normalny"}`,
        request.link ? `**Link do produktu:** ${request.link}` : null,
        request.proforma_filename ? `**Proforma:** ${request.proforma_filename}` : null,
        `**Data zlozenia:** ${new Date(request.created_at).toLocaleString("pl-PL")}`,
        `**ID wniosku:** ${request.id}`,
      ].filter(Boolean).join("\n");
    }

    const { data: mappings } = await supabase
      .from("clickup_field_mappings")
      .select("*")
      .eq("enabled", true)
      .order("sort_order");

    const cachedFields: any[] = config.cached_custom_fields || [];

    const customFields: Array<{ id: string; value: string | number }> = [];
    if (mappings && mappings.length > 0) {
      for (const mapping of mappings) {
        const rawValue = getAppFieldValue(request, mapping.app_field);
        if (rawValue === null || rawValue === undefined || rawValue === "") continue;

        const fieldDef = cachedFields.find((f: any) => f.id === mapping.clickup_field_id);
        const fieldType = fieldDef?.type || mapping.clickup_field_type;

        if (fieldType === "drop_down" || fieldType === "labels") {
          const options: any[] = fieldDef?.type_config?.options || [];
          const match = options.find(
            (o: any) => o.name?.toLowerCase() === String(rawValue).toLowerCase()
          );
          if (match) {
            customFields.push({ id: mapping.clickup_field_id, value: match.id });
          }
        } else if (fieldType === "number" || fieldType === "currency") {
          const num = parseFloat(String(rawValue));
          if (!isNaN(num)) {
            customFields.push({ id: mapping.clickup_field_id, value: num });
          }
        } else {
          customFields.push({ id: mapping.clickup_field_id, value: String(rawValue) });
        }
      }
    }

    const taskPayload: Record<string, any> = {
      name: taskName,
      description: taskDescription,
      priority: priorityClickUp,
      notify_all: false,
    };

    if (customFields.length > 0) {
      taskPayload.custom_fields = customFields;
    }

    const createRes = await fetch(
      `https://api.clickup.com/api/v2/list/${config.list_id}/task`,
      {
        method: "POST",
        headers: {
          Authorization: clickupAuthHeader(config.api_token),
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taskPayload),
      }
    );

    if (!createRes.ok) {
      const errData = await createRes.json().catch(() => ({}));
      throw new Error(errData.err || `Blad tworzenia zadania ClickUp: ${createRes.status}`);
    }

    const task = await createRes.json();

    await supabase
      .from("purchase_requests")
      .update({ clickup_task_id: task.id })
      .eq("id", purchase_request_id);

    return new Response(
      JSON.stringify({ success: true, task_id: task.id, task_url: task.url }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("create-clickup-task error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Nieznany blad" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
