// NIPS Portal - scheduled class reminders
// Intended for Supabase Scheduler. Sends one class reminder per paid student
// per matching batch per day, guarded by notification_logs.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { ORIENTATION_CONFIRMATION_TEXT, T, sendEmail } from "../_shared/templates.ts";

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const TIME_ZONE = "Asia/Karachi";
const REMINDER_WINDOW_MINUTES = 90;
const PORTAL_URL = "https://nips.com.pk/portal/student.html?view=classes";

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

function orientationReminderStage(scheduledAt: string, now = new Date()) {
  const minutesUntil = (new Date(scheduledAt).getTime() - now.getTime()) / 60000;
  if (minutesUntil > 0 && minutesUntil <= 10) return { key: "10m", label: "in 10 minutes" };
  if (minutesUntil > 0 && minutesUntil <= 60) return { key: "1h", label: "in one hour" };
  if (minutesUntil <= 0) return null;

  const today = localParts(now).date;
  const scheduledDate = localParts(new Date(scheduledAt)).date;
  const calendarDaysUntil = Math.round((Date.parse(`${scheduledDate}T00:00:00Z`) - Date.parse(`${today}T00:00:00Z`)) / 86_400_000);
  const label = calendarDaysUntil <= 0 ? "later today" : calendarDaysUntil === 1 ? "tomorrow" : `in ${calendarDaysUntil} days`;
  return { key: `daily:${today}`, label };
}

async function sendOrientationAnnouncementCatchups(svc: any, apiKey: string) {
  const { data: cohorts, error } = await svc.from("orientation_cohorts")
    .select("id,batch_id,name,scheduled_at,student_message,notifications_enabled_for_scheduled_at")
    .eq("session_state", "scheduled").not("notifications_enabled_for_scheduled_at", "is", null);
  if (error) return { sent: 0, skipped: 0, failures: [error.message] };
  let sent = 0, skipped = 0;
  const failures: string[] = [];
  for (const cohort of cohorts || []) {
    if (!cohort.scheduled_at || new Date(cohort.scheduled_at).getTime() !== new Date(cohort.notifications_enabled_for_scheduled_at).getTime()) continue;
    const { data: batch } = await svc.from("batches").select("name,schedule").eq("id", cohort.batch_id).single();
    const { data: applications } = await svc.from("orientation_applications").select("student_id").eq("cohort_id", cohort.id);
    const ids = [...new Set((applications || []).map((application) => application.student_id))];
    if (!ids.length) continue;
    const { data: profiles } = await svc.from("profiles").select("id,full_name").in("id", ids);
    for (const profile of profiles || []) {
      const deliveryKey = `orientation:${cohort.id}:${cohort.scheduled_at}:announced`;
      await svc.from("portal_notifications").upsert({
        recipient_id: profile.id,
        notification_type: "orientation_scheduled",
        title: "Your orientation is scheduled",
        message: `${batch?.name || cohort.name} — ${batch?.schedule || "see the portal for details"}. ${ORIENTATION_CONFIRMATION_TEXT}`,
        action_url: PORTAL_URL,
        delivery_key: deliveryKey,
      }, { onConflict: "recipient_id,delivery_key", ignoreDuplicates: true });
      const { data: existing } = await svc.from("notification_logs").select("id")
        .eq("notification_type", "orientation_scheduled").eq("batch_id", cohort.batch_id)
        .eq("student_id", profile.id).eq("delivery_key", deliveryKey).maybeSingle();
      if (existing) { skipped++; continue; }
      const { data: authUser } = await svc.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) { failures.push(`${profile.full_name} (no email)`); continue; }
      const message = T.orientation_scheduled({
        name: profile.full_name,
        batch: batch?.name || cohort.name,
        schedule: batch?.schedule,
        message: cohort.student_message,
      });
      const result = await sendEmail(apiKey, FROM, email, message.subject, message.html);
      if (!result.ok) { failures.push(`${email}: ${result.error}`); continue; }
      await svc.from("notification_logs").insert({
        notification_type: "orientation_scheduled", batch_id: cohort.batch_id,
        student_id: profile.id, delivery_key: deliveryKey,
      });
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
  }
  return { sent, skipped, failures };
}

async function sendOrientationReminders(svc: any, apiKey: string, now = new Date()) {
  const { data: cohorts, error } = await svc.from("orientation_cohorts")
    .select("id,batch_id,name,scheduled_at,student_message,meet_url")
    .in("session_state", ["scheduled", "live"]).not("scheduled_at", "is", null);
  if (error) return { sent: 0, skipped: 0, failures: [error.message] };
  let sent = 0, skipped = 0;
  const failures: string[] = [];
  for (const cohort of cohorts || []) {
    const stage = orientationReminderStage(cohort.scheduled_at, now);
    if (!stage) continue;
    const meetUrl = /^https:\/\/meet\.google\.com\/[a-z0-9-]+(?:[/?].*)?$/i.test(cohort.meet_url || "")
      ? cohort.meet_url : undefined;
    const { data: batch } = await svc.from("batches").select("name,schedule").eq("id", cohort.batch_id).single();
    const { data: applications } = await svc.from("orientation_applications").select("student_id").eq("cohort_id", cohort.id);
    const ids = [...new Set((applications || []).map((application) => application.student_id))];
    if (!ids.length) continue;
    const { data: profiles } = await svc.from("profiles").select("id,full_name").in("id", ids);
    for (const profile of profiles || []) {
      const deliveryKey = `orientation:${cohort.id}:${cohort.scheduled_at}:${stage.key}`;
      const announcementKey = `orientation:${cohort.id}:${cohort.scheduled_at}:announced`;
      const { data: announcement } = await svc.from("notification_logs").select("sent_at")
        .eq("notification_type", "orientation_scheduled").eq("batch_id", cohort.batch_id)
        .eq("student_id", profile.id).eq("delivery_key", announcementKey).maybeSingle();
      const announcedToday = announcement && localParts(new Date(announcement.sent_at)).date === localParts(now).date;
      const announcementIsRecent = now.getTime() - new Date(announcement?.sent_at || 0).getTime() < 60 * 60000;
      if (!announcement || (stage.key !== "10m" && announcementIsRecent) || (stage.key.startsWith("daily:") && announcedToday)) {
        skipped++;
        continue;
      }
      await svc.from("portal_notifications").upsert({
        recipient_id: profile.id,
        notification_type: "orientation_reminder",
        title: `Orientation starts ${stage.label}`,
        message: `${batch?.name || cohort.name} — ${batch?.schedule || "see the portal for details"}`,
        action_url: stage.key === "10m" && meetUrl ? meetUrl : PORTAL_URL,
        delivery_key: deliveryKey,
      }, { onConflict: "recipient_id,delivery_key", ignoreDuplicates: true });
      const { data: existing } = await svc.from("notification_logs").select("id")
        .eq("notification_type", "orientation_reminder").eq("batch_id", cohort.batch_id)
        .eq("student_id", profile.id).eq("delivery_key", deliveryKey).maybeSingle();
      if (existing) { skipped++; continue; }
      const { data: authUser } = await svc.auth.admin.getUserById(profile.id);
      const email = authUser?.user?.email;
      if (!email) { failures.push(`${profile.full_name} (no email)`); continue; }
      const message = T.orientation_reminder({
        name: profile.full_name,
        batch: batch?.name || cohort.name,
        schedule: batch?.schedule,
        title: stage.label,
        message: cohort.student_message,
        joinUrl: meetUrl,
      });
      const result = await sendEmail(apiKey, FROM, email, message.subject, message.html);
      if (!result.ok) { failures.push(`${email}: ${result.error}`); continue; }
      await svc.from("notification_logs").insert({
        notification_type: "orientation_reminder", batch_id: cohort.batch_id,
        student_id: profile.id, delivery_key: deliveryKey,
      });
      sent++;
      await new Promise((resolve) => setTimeout(resolve, 550));
    }
  }
  return { sent, skipped, failures };
}

Deno.serve(async (req) => {
  try {
    const configuredSecret = Deno.env.get("SCHEDULE_SECRET");
    const publishableKey = Deno.env.get("SUPABASE_ANON_KEY");
    if (configuredSecret) {
      const suppliedSecret = req.headers.get("x-schedule-secret") || req.headers.get("authorization")?.replace("Bearer ", "");
      if (suppliedSecret !== configuredSecret && suppliedSecret !== publishableKey) return json({ error: "Forbidden" }, 403);
    }

    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Reminder service is not configured" }, 500);
    }

    if (new URL(req.url).searchParams.get("health") === "1") {
      return json({ ok: true, service: "class-reminders" });
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

    const orientation = await sendOrientationReminders(svc, RESEND_API_KEY);
    const orientationCatchup = await sendOrientationAnnouncementCatchups(svc, RESEND_API_KEY);
    return json({
      ok: failures.length === 0 && orientation.failures.length === 0 && orientationCatchup.failures.length === 0,
      sent, skipped, failures,
      orientation,
      orientationCatchup,
    });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
