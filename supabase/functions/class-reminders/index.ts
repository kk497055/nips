// NIPS Portal - scheduled class reminders
// Intended for Supabase Scheduler. Sends one class reminder per paid student
// per matching batch per day, guarded by notification_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { T, sendEmail } from "../_shared/templates.ts";

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_ZONE = "Asia/Karachi";
const REMINDER_WINDOW_MINUTES = 90;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function localParts(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    weekday: "short",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).formatToParts(now);
  const value = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return {
    weekday: value("weekday"),
    date: `${value("year")}-${value("month")}-${value("day")}`,
    minutes: Number(value("hour")) * 60 + Number(value("minute")),
  };
}

function shouldSendReminder(schedule = "", now = new Date()) {
  const local = localParts(now);
  if (!new RegExp(`\\b${local.weekday}\\b`, "i").test(schedule)) return false;

  const time = schedule.match(/\b([01]?\d|2[0-3]):([0-5]\d)\b/);
  if (!time) return true;

  const classMinutes = Number(time[1]) * 60 + Number(time[2]);
  const minutesUntilClass = classMinutes - local.minutes;
  return minutesUntilClass >= 0 && minutesUntilClass <= REMINDER_WINDOW_MINUTES;
}

Deno.serve(async (req) => {
  try {
    const configuredSecret = Deno.env.get("SCHEDULE_SECRET");
    if (configuredSecret) {
      const suppliedSecret = req.headers.get("x-schedule-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
      if (suppliedSecret !== configuredSecret) return json({ error: "Forbidden" }, 403);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Reminder service is not configured" }, 500);
    }

    const force = new URL(req.url).searchParams.get("force") === "1";
    const today = localParts().date;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const { data: batches, error: batchError } = await svc
      .from("batches")
      .select("id,name,schedule")
      .eq("is_active", true);
    if (batchError) return json({ error: batchError.message }, 500);

    let sent = 0;
    let skipped = 0;
    const failures: string[] = [];

    for (const batch of batches ?? []) {
      if (!force && !shouldSendReminder(batch.schedule)) {
        skipped++;
        continue;
      }

      const { data: enrollments } = await svc
        .from("enrollments")
        .select("student_id")
        .eq("batch_id", batch.id)
        .eq("payment_status", "paid");
      const ids = (enrollments ?? []).map((e) => e.student_id);
      if (!ids.length) continue;

      const { data: profiles } = await svc.from("profiles").select("id,full_name").in("id", ids);
      for (const profile of profiles ?? []) {
        const { data: existingLog } = await svc
          .from("notification_logs")
          .select("id")
          .eq("notification_type", "class_reminder")
          .eq("batch_id", batch.id)
          .eq("student_id", profile.id)
          .eq("delivery_key", today)
          .maybeSingle();
        if (existingLog) {
          skipped++;
          continue;
        }

        const { data: authUser } = await svc.auth.admin.getUserById(profile.id);
        const email = authUser?.user?.email;
        if (!email) {
          failures.push(`${profile.full_name} (no email)`);
          continue;
        }

        const { subject, html } = T.class_reminder({
          name: profile.full_name,
          batch: batch.name,
          schedule: batch.schedule,
        });
        const result = await sendEmail(RESEND_API_KEY, FROM, email, subject, html);
        if (result.ok) {
          await svc.from("notification_logs").insert({
            notification_type: "class_reminder",
            batch_id: batch.id,
            student_id: profile.id,
            delivery_key: today,
          });
          sent++;
        } else {
          failures.push(`${email}: ${result.error}`);
        }
      }
    }

    return json({ ok: sent > 0, sent, skipped, failures });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
