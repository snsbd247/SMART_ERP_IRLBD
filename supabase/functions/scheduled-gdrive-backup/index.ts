// Scheduled Google Drive backup — invoked by pg_cron.
// Checks backup_settings.auto_backup_enabled + gdrive_enabled and schedule_interval,
// generates a SQL backup (reusing create-backup) and uploads via google-drive-backup.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

const INTERVAL_HOURS: Record<string, number> = {
  hourly: 1,
  daily: 24,
  weekly: 24 * 7,
  monthly: 24 * 30,
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response(null, { headers: corsHeaders });
  const log: string[] = [];
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const db = createClient(SUPABASE_URL, SERVICE);

    const { data: settings } = await db.from("backup_settings").select("*").limit(1).maybeSingle();
    if (!settings) {
      return new Response(JSON.stringify({ success: true, skipped: "no_settings" }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const autoOn = !!settings.auto_backup_enabled;
    const gdriveOn = !!settings.gdrive_enabled;
    const interval = (settings.schedule_interval || "daily").toLowerCase();
    const hours = INTERVAL_HOURS[interval] ?? 24;

    if (!autoOn || !gdriveOn) {
      return new Response(JSON.stringify({ success: true, skipped: "disabled", autoOn, gdriveOn }), {
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const last = settings.last_gdrive_backup_at ? new Date(settings.last_gdrive_backup_at) : null;
    const nowMs = Date.now();
    if (last && nowMs - last.getTime() < hours * 3600 * 1000 - 60_000) {
      return new Response(JSON.stringify({
        success: true, skipped: "not_due", next_in_minutes: Math.round((hours * 3600 * 1000 - (nowMs - last.getTime())) / 60_000),
      }), { headers: { ...corsHeaders, "Content-Type": "application/json" } });
    }

    // 1) Generate backup content by calling create-backup with service key
    const genRes = await fetch(`${SUPABASE_URL}/functions/v1/create-backup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", apikey: SERVICE },
      body: JSON.stringify({ format: "sql", scheduled: true }),
    });
    const genData = await genRes.json();
    if (!genRes.ok || !genData?.content) {
      throw new Error("create-backup failed: " + JSON.stringify(genData).slice(0, 500));
    }
    log.push(`generated ${genData.content.length} bytes`);

    // 2) Upload via google-drive-backup (also using service key as bearer)
    const upRes = await fetch(`${SUPABASE_URL}/functions/v1/google-drive-backup`, {
      method: "POST",
      headers: { Authorization: `Bearer ${SERVICE}`, "Content-Type": "application/json", apikey: SERVICE },
      body: JSON.stringify({ action: "upload", backup_content: genData.content, backup_file_name: genData.file_name || "scheduled.sql" }),
    });
    const upData = await upRes.json();
    if (!upRes.ok || !upData?.success) {
      await db.from("backup_settings").update({ last_gdrive_error: JSON.stringify(upData).slice(0, 500) }).eq("id", settings.id);
      throw new Error("upload failed: " + JSON.stringify(upData).slice(0, 500));
    }

    await db.from("backup_settings").update({
      last_gdrive_backup_at: new Date().toISOString(),
      last_auto_backup_at: new Date().toISOString(),
      last_gdrive_error: null,
    }).eq("id", settings.id);

    await db.from("audit_log").insert({
      module: "Backup", action: "Scheduled Cloud Backup",
      details: `Auto-uploaded ${upData.file_name} (${interval}) via cron`,
      user_name: "system",
    });

    return new Response(JSON.stringify({ success: true, file_name: upData.file_name, file_id: upData.file_id, log }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("scheduled-gdrive-backup error:", message);
    return new Response(JSON.stringify({ success: false, error: message, log }), {
      status: 500, headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
