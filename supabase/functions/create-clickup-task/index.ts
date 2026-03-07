import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

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

    if (body.action === "test_connection") {
      if (!config?.api_token) {
        throw new Error("Brak tokenu API ClickUp w konfiguracji");
      }
      const testRes = await fetch("https://api.clickup.com/api/v2/user", {
        headers: { Authorization: config.api_token },
      });
      if (!testRes.ok) {
        const err = await testRes.json();
        throw new Error(err.err || "Nieprawidlowy token API ClickUp");
      }
      const userData = await testRes.json();
      return new Response(
        JSON.stringify({ success: true, workspace: userData.user?.username }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { purchase_request_id } = body;
    if (!purchase_request_id) {
      throw new Error("Brak purchase_request_id");
    }

    if (!config?.enabled) {
      return new Response(
        JSON.stringify({ success: false, message: "Integracja ClickUp jest wylaczona" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!config.api_token || !config.list_id) {
      throw new Error("Niekompletna konfiguracja ClickUp (brak tokenu lub ID listy)");
    }

    const { data: request, error: reqError } = await supabase
      .from("purchase_requests")
      .select(`
        *,
        submitter:profiles!purchase_requests_user_id_fkey(full_name, email),
        department:departments!purchase_requests_department_id_fkey(name)
      `)
      .eq("id", purchase_request_id)
      .maybeSingle();

    if (reqError) throw new Error(`Request error: ${reqError.message}`);
    if (!request) throw new Error("Wniosek zakupowy nie znaleziony");

    if (request.clickup_task_id) {
      return new Response(
        JSON.stringify({ success: true, task_id: request.clickup_task_id, message: "Zadanie juz istnieje w ClickUp" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const priorityMap: Record<string, number> = {
      urgent: 1,
      high: 2,
      normal: 3,
      low: 4,
    };

    const submitterName = request.submitter?.full_name || "Nieznany uzytkownik";
    const submitterEmail = request.submitter?.email || "";
    const departmentName = request.department?.name || "Brak dzialu";
    const priorityClickUp = priorityMap[request.priority?.toLowerCase()] ?? 3;

    const amountFormatted = request.gross_amount
      ? new Intl.NumberFormat("pl-PL", { style: "currency", currency: "PLN" }).format(request.gross_amount)
      : "Brak kwoty";

    const descriptionLines = [
      `**Wnioskodawca:** ${submitterName} (${submitterEmail})`,
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

    const taskPayload = {
      name: `Wniosek zakupowy: ${request.description?.slice(0, 80) || "Bez opisu"}`,
      description: descriptionLines,
      priority: priorityClickUp,
      notify_all: false,
      custom_fields: [],
    };

    const createRes = await fetch(
      `https://api.clickup.com/api/v2/list/${config.list_id}/task`,
      {
        method: "POST",
        headers: {
          Authorization: config.api_token,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(taskPayload),
      }
    );

    if (!createRes.ok) {
      const errData = await createRes.json();
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
