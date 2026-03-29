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

  let raw = "";

  if (statusItem) {
    const after = statusItem.after;
    if (typeof after === "string") {
      raw = after;
    } else if (after && typeof after === "object") {
      raw = after.status ?? after.name ?? "";
      if (typeof raw === "object") {
        raw = raw?.status ?? raw?.name ?? "";
      }
    }
  }

  if (!raw) {
    const ts = body.task?.status;
    if (typeof ts === "string") raw = ts;
    else if (ts && typeof ts === "object") raw = ts.status ?? ts.name ?? "";
  }

  if (!raw) {
    const bs = body.status;
    if (typeof bs === "string") raw = bs;
    else if (bs && typeof bs === "object") raw = bs.status ?? bs.name ?? "";
  }

  return raw.toLowerCase().trim();
}

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get("SUPABASE_URL")!,
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!
  );

  let body: any = {};
  const rawText = await req.text();

  try {
    body = JSON.parse(rawText);
  } catch {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: "parse_error",
      raw_payload: { raw: rawText.slice(0, 2000) },
      result_message: "Nieprawidlowy JSON",
    });
    return new Response(
      JSON.stringify({ message: "Nieprawidlowy JSON" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const eventName: string = (body.event || "").toLowerCase();
  const taskId = extractTaskId(body);
  const newStatus = extractNewStatus(body);

  console.log("ClickUp webhook | Event:", eventName, "| Task:", taskId, "| Status:", newStatus);

  const isStatusEvent =
    eventName.includes("taskstatusupdated") ||
    eventName.includes("task.status") ||
    eventName.includes("task_status") ||
    newStatus !== "";

  if (!isStatusEvent || !newStatus) {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: taskId,
      extracted_status: newStatus,
      raw_payload: body,
      result_message: "Ignorowane - brak statusu lub nieobslugiwane zdarzenie",
    });
    return new Response(
      JSON.stringify({ message: "Ignorowane zdarzenie: " + eventName }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: config } = await supabase
    .from("clickup_config")
    .select("paid_status")
    .limit(1)
    .maybeSingle();

  const configuredPaidStatus = (config?.paid_status || "").toLowerCase().trim();
  const defaultPaidStatuses = ["complete", "completed", "done", "closed", "paid", "oplacone", "opłacone", "oplac", "op\u0142acone"];

  const isCompleted = configuredPaidStatus
    ? newStatus === configuredPaidStatus
    : defaultPaidStatuses.some((s) => newStatus.includes(s) || s.includes(newStatus));

  console.log("Paid status config:", configuredPaidStatus || "(domyslne)", "| Match:", isCompleted);

  if (!isCompleted) {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: taskId,
      extracted_status: newStatus,
      raw_payload: body,
      matched_paid: false,
      result_message: `Status '${newStatus}' nie pasuje do statusu oplacenia`,
    });
    return new Response(
      JSON.stringify({ message: `Status '${newStatus}' nie pasuje, pomijam` }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!taskId) {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: "",
      extracted_status: newStatus,
      raw_payload: body,
      matched_paid: true,
      result_message: "Brak task_id w payloadzie",
    });
    return new Response(
      JSON.stringify({ message: "Brak task_id" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { data: request, error: findError } = await supabase
    .from("purchase_requests")
    .select("id, status")
    .eq("clickup_task_id", taskId)
    .maybeSingle();

  if (findError) {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: taskId,
      extracted_status: newStatus,
      raw_payload: body,
      matched_paid: true,
      result_message: "DB error: " + findError.message,
    });
    return new Response(
      JSON.stringify({ error: findError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (!request) {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: taskId,
      extracted_status: newStatus,
      raw_payload: body,
      matched_paid: true,
      result_message: "Nie znaleziono wniosku dla task_id: " + taskId,
    });
    return new Response(
      JSON.stringify({ message: "Nie znaleziono wniosku dla task_id: " + taskId }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  if (request.status === "paid") {
    await supabase.from("clickup_webhook_logs").insert({
      event_name: eventName,
      task_id: taskId,
      extracted_status: newStatus,
      raw_payload: body,
      matched_paid: true,
      result_message: "Wniosek juz oplacony: " + request.id,
    });
    return new Response(
      JSON.stringify({ message: "Wniosek juz oznaczony jako oplacony" }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  const { error: updateError } = await supabase
    .from("purchase_requests")
    .update({ status: "paid", paid_at: new Date().toISOString() })
    .eq("id", request.id);

  const resultMsg = updateError
    ? "Update error: " + updateError.message
    : "Oznaczono jako oplacony: " + request.id;

  await supabase.from("clickup_webhook_logs").insert({
    event_name: eventName,
    task_id: taskId,
    extracted_status: newStatus,
    raw_payload: body,
    matched_paid: true,
    result_message: resultMsg,
  });

  if (updateError) {
    return new Response(
      JSON.stringify({ error: updateError.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }

  console.log("Purchase request", request.id, "marked as paid via ClickUp webhook");

  return new Response(
    JSON.stringify({ success: true, request_id: request.id }),
    { headers: { ...corsHeaders, "Content-Type": "application/json" } }
  );
});
