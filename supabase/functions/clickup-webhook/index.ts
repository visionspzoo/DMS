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
    console.log("ClickUp webhook payload:", JSON.stringify(body));

    const eventName: string = body.event || "";
    const taskId: string = body.task_id || body.history_items?.[0]?.task?.id || "";

    if (!eventName.includes("taskStatusUpdated") && !eventName.includes("task.status")) {
      return new Response(
        JSON.stringify({ message: "Ignorowane zdarzenie: " + eventName }),
        { headers: { ...corsHeaders, "Content-Type": "application/json" } }
      );
    }

    const historyItems: any[] = body.history_items || [];
    const statusItem = historyItems.find((item: any) => item.field === "status");

    const newStatus: string =
      statusItem?.after?.status?.toLowerCase() ||
      body.task?.status?.status?.toLowerCase() ||
      "";

    console.log("Task ID:", taskId, "New status:", newStatus);

    if (!newStatus) {
      return new Response(
        JSON.stringify({ message: "Brak statusu w payloadzie" }),
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
      : defaultPaidStatuses.includes(newStatus);

    console.log(
      "Configured paid status:", configuredPaidStatus || "(brak - uzywam domyslnych)",
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
        JSON.stringify({ message: "Brak task_id w payloadzie" }),
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
      .update({ status: "paid" })
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
