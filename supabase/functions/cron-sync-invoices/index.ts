import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
  "Access-Control-Allow-Headers":
    "Content-Type, Authorization, X-Client-Info, Apikey",
};

const SYNC_INTERVAL_MS = 60 * 60 * 1000;
const STALL_TIMEOUT_MS = 10 * 60 * 1000;

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
    const stallCutoff = new Date(Date.now() - STALL_TIMEOUT_MS).toISOString();

    const headers = {
      Authorization: `Bearer ${supabaseServiceKey}`,
      "Content-Type": "application/json",
    };

    const results: any[] = [];

    const { data: stalledJobs } = await supabase
      .from("email_sync_jobs")
      .select("id, user_id, email_config_id, status, last_chunk_at")
      .eq("status", "running")
      .lt("last_chunk_at", stallCutoff);

    for (const job of stalledJobs || []) {
      console.log(`[cron] Marking stalled job ${job.id} as pending for resume`);
      await supabase
        .from("email_sync_jobs")
        .update({ status: "pending", error_message: "Wznowione po timeout" })
        .eq("id", job.id);
    }

    const { data: pendingJobs } = await supabase
      .from("email_sync_jobs")
      .select("id, user_id, email_config_id")
      .eq("status", "pending")
      .order("created_at", { ascending: true })
      .limit(10);

    for (const job of pendingJobs || []) {
      try {
        console.log(`[cron] Resuming pending email sync job ${job.id} for user ${job.user_id}`);

        let hasMore = true;
        let chunkCount = 0;
        const MAX_CHUNKS = 50;
        let totalProcessed = 0;
        let totalSynced = 0;

        while (hasMore && chunkCount < MAX_CHUNKS) {
          chunkCount++;

          const { data: currentJob } = await supabase
            .from("email_sync_jobs")
            .select("status")
            .eq("id", job.id)
            .maybeSingle();

          if (!currentJob || currentJob.status === "completed" || currentJob.status === "failed") {
            hasMore = false;
            break;
          }

          const res = await fetch(
            `${supabaseUrl}/functions/v1/sync-user-email-invoices?resume_chunk=1`,
            {
              method: "POST",
              headers,
              body: JSON.stringify({ user_id: job.user_id, resume_job_id: job.id }),
            }
          );
          const body = await res.json().catch(() => ({}));
          console.log(`[cron] chunk ${chunkCount} for job ${job.id}: processed=${body.processed}, synced=${body.synced}, hasMore=${body.hasMore}`);

          if (!res.ok) {
            console.error(`[cron] chunk error for job ${job.id}:`, body.error);
            break;
          }

          totalProcessed += body.processed || 0;
          totalSynced += body.synced || 0;
          hasMore = body.hasMore === true;

          if (hasMore) await new Promise(r => setTimeout(r, 500));
        }

        results.push({
          type: "resume_job",
          job_id: job.id,
          user_id: job.user_id,
          status: "ok",
          detail: `chunks: ${chunkCount}, processed: ${totalProcessed}, synced: ${totalSynced}`,
        });
      } catch (err: any) {
        results.push({ type: "resume_job", job_id: job.id, status: "error", detail: err.message });
      }
    }

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

    const usersNeedingSync = new Map<string, { email: boolean; drive: boolean }>();

    for (const config of emailUsers || []) {
      if (!config.last_sync_at || config.last_sync_at < cutoff) {
        const existing = usersNeedingSync.get(config.user_id) || { email: false, drive: false };
        existing.email = true;
        usersNeedingSync.set(config.user_id, existing);
      }
    }

    for (const config of [...(driveUsers || []), ...(legacyDriveUsers || [])]) {
      if (!config.last_sync_at || config.last_sync_at < cutoff) {
        const existing = usersNeedingSync.get(config.user_id) || { email: false, drive: false };
        existing.drive = true;
        usersNeedingSync.set(config.user_id, existing);
      }
    }

    for (const [userId, needs] of usersNeedingSync) {
      const entry: any = { user_id: userId };

      if (needs.email) {
        const { data: activeJobs } = await supabase
          .from("email_sync_jobs")
          .select("id")
          .eq("user_id", userId)
          .in("status", ["pending", "running"])
          .limit(1);

        if (activeJobs && activeJobs.length > 0) {
          entry.email = `skipped: active job already running (${activeJobs[0].id})`;
        } else {
          try {
            const res = await fetch(
              `${supabaseUrl}/functions/v1/sync-user-email-invoices`,
              {
                method: "POST",
                headers,
                body: JSON.stringify({ user_id: userId }),
              }
            );
            const body = await res.json().catch(() => ({}));
            entry.email = res.ok ? `ok, synced: ${body.synced || 0}` : `error: ${body.error}`;
          } catch (err: any) {
            entry.email = `error: ${err.message}`;
          }
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
          const body = await res.json().catch(() => ({}));
          entry.drive = res.ok ? `ok, synced: ${body.total_synced || 0}` : `error: ${body.error}`;
        } catch (err: any) {
          entry.drive = `error: ${err.message}`;
        }
      }

      results.push(entry);
    }

    return new Response(
      JSON.stringify({
        success: true,
        users_processed: usersNeedingSync.size,
        resumed_jobs: (pendingJobs || []).length,
        stalled_reset: (stalledJobs || []).length,
        results,
      }),
      { headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  } catch (error: any) {
    console.error("Cron sync error:", error);
    return new Response(
      JSON.stringify({ success: false, error: error.message }),
      { status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" } }
    );
  }
});
