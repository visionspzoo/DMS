import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYNC_INTERVAL_MS = 60 * 60 * 1000;

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 200, headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const { createClient } = await import("npm:@supabase/supabase-js@2");
    const supabase = createClient(supabaseUrl, supabaseServiceKey);

    const cutoff = new Date(Date.now() - SYNC_INTERVAL_MS).toISOString();

    const { data: emailUsers } = await supabase
      .from("user_email_configs")
      .select("user_id, last_sync_at")
      .eq("is_active", true);

    const { data: driveUsers } = await supabase
      .from("user_drive_folder_mappings")
      .select("user_id, last_sync_at")
      .eq("is_active", true);

    const { data: legacyDriveUsers } = await supabase
      .from("user_drive_configs")
      .select("user_id, last_sync_at")
      .eq("is_active", true);

    const usersNeedingSync = new Map<
      string,
      { email: boolean; drive: boolean }
    >();

    for (const config of emailUsers || []) {
      if (!config.last_sync_at || config.last_sync_at < cutoff) {
        const existing = usersNeedingSync.get(config.user_id) || {
          email: false,
          drive: false,
        };
        existing.email = true;
        usersNeedingSync.set(config.user_id, existing);
      }
    }

    for (const config of [...(driveUsers || []), ...(legacyDriveUsers || [])]) {
      if (!config.last_sync_at || config.last_sync_at < cutoff) {
        const existing = usersNeedingSync.get(config.user_id) || {
          email: false,
          drive: false,
        };
        existing.drive = true;
        usersNeedingSync.set(config.user_id, existing);
      }
    }

    const results: { user_id: string; email?: string; drive?: string }[] = [];
    const headers = {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    };

    for (const [userId, needs] of usersNeedingSync) {
      const entry: { user_id: string; email?: string; drive?: string } = {
        user_id: userId,
      };

      if (needs.email) {
        try {
          const res = await fetch(
            `${supabaseUrl}/functions/v1/sync-user-email-invoices`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ user_id: userId }),
            }
          );
          const body = await res.json();
          entry.email = res.ok
            ? `ok, synced: ${body.synced || 0}`
            : `error: ${body.error}`;
        } catch (err: any) {
          entry.email = `error: ${err.message}`;
        }
      }

      if (needs.drive) {
        try {
          const res = await fetch(
            `${supabaseUrl}/functions/v1/sync-user-drive-invoices`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ user_id: userId }),
            }
          );
          const body = await res.json();
          entry.drive = res.ok
            ? `ok, synced: ${body.total_synced || 0}`
            : `error: ${body.error}`;
        } catch (err: any) {
          entry.drive = `error: ${err.message}`;
        }
      }

      results.push(entry);
    }

    return new Response(
      JSON.stringify({
        success: true,
        users_processed: results.length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Cron sync error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      {
        status: 500,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      }
    );
  }
});
