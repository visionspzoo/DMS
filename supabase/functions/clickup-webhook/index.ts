import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Client-Info, Apikey",
};

function extractTaskId(body: any): string {
  return (
    body.task_id ||
    body.id ||
    body.task?.id ||
    body.history_items?.[0]?.id ||
    body.history_items?.[0]?.task?.id ||
    ""
  );
}

function extractNewStatus(body: any): string {
  const historyItems: any[] = body.history_items || [];
  const statusItem = historyItems.find((item: any) => item.field === "status");

  return (
    statusItem?.after?.status ||
    statusItem?.after?.status?.status ||
    body.task?.status?.status ||
    body.status?.status ||
    body.status ||
    ""
  ).toLowerCase().trim();
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

    let body: any;
    const rawText = await req.text();
    console.log("ClickUp webhook raw body:", rawText);
    console.log("ClickUp webhook headers:", JSON.stringify(Object.fromEntries(req.headers.entries())));

    try {
      body = JSON.parse(rawText);
    } catch {
      return new Response(
        JSON.stringify({ message: "Nieprawidlowy JSON", raw: rawText.slice(0, 200) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const eventName: string = (body.event || "").toLowerCase();
    const taskId = extractTaskId(body);
    const newStatus = extractNewStatus(body);

    console.log("Event:", eventName, "| Task ID:", taskId, "| Status:", newStatus);

    const isStatusEvent =
      eventName.includes("taskstatusupdated") ||
      eventName.includes("task.status") ||
      eventName.includes("task_status") ||
      newStatus !== "";

    if (!isStatusEvent) {
      return new Response(
        JSON.stringify({ message: "Ignorowane zdarzenie: " + eventName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!newStatus) {
      return new Response(
        JSON.stringify({ message: "Brak statusu w payloadzie", event: eventName, task_id: taskId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: config } = await supabase
      .from("clickup_config")
      .select("paid_status")
      .limit(1)
      .maybeSingle();

    const configuredPaidStatus = (config?.paid_status || "").toLowerCase().trim();
    const defaultPaidStatuses = ["complete", "completed", "done", "closed", "paid", "oplacone", "opłacone"];

    const isCompleted = configuredPaidStatus
      ? newStatus === configuredPaidStatus
      : defaultPaidStatuses.some((s) => newStatus.includes(s) || s.includes(newStatus));

    console.log(
      "Configured paid status:", configuredPaidStatus || "(brak - uzywam domyslnych)",
      "| Nowy status:", newStatus,
      "| Czy pasuje:", isCompleted
    );

    if (!isCompleted) {
      return new Response(
        JSON.stringify({
          message: `Status '${newStatus}' nie odpowiada statusowi oplacenia ('${configuredPaidStatus || defaultPaidStatuses.join(", ")}'), pomijam`,
        }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (!taskId) {
      return new Response(
        JSON.stringify({ message: "Brak task_id w payloadzie", body_keys: Object.keys(body) }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { data: request, error: findError } = await supabase
      .from("purchase_requests")
      .select("id, status")
      .eq("clickup_task_id", taskId)
      .maybeSingle();

    if (findError) throw new Error(`DB error: ${findError.message}`);

    if (!request) {
      console.log("Nie znaleziono wniosku dla task_id:", taskId);
      return new Response(
        JSON.stringify({ message: "Nie znaleziono wniosku dla task_id: " + taskId }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    if (request.status === "paid") {
      return new Response(
        JSON.stringify({ message: "Wniosek juz oznaczony jako oplacony" }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const { error: updateError } = await supabase
      .from("purchase_requests")
      .update({ status: "paid", paid_at: new Date().toISOString() })
      .eq("id", request.id);

    if (updateError) throw new Error(`Update error: ${updateError.message}`);

    console.log("Purchase request", request.id, "marked as paid via ClickUp webhook");

    return new Response(
      JSON.stringify({ success: true, request_id: request.id, message: "Wniosek oznaczony jako oplacony" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (err: any) {
    console.error("clickup-webhook error:", err);
    return new Response(
      JSON.stringify({ error: err.message || "Nieznany blad" }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
