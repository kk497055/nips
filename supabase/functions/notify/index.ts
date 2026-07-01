// NIPS Portal - notification suite (Resend)
// Verifies the caller, resolves recipient emails server-side, renders the
// branded template, and sends one email per recipient.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { T, sendEmail } from "../_shared/templates.ts";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS, "Content-Type": "application/json" },
  });

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const ADMIN_TYPES = new Set(["welcome", "enrolment_paid", "payment_reminder", "class_reminder", "announcement"]);
const TEACHER_TYPES = new Set(["new_recording", "class_reminder"]);
const BATCH_WIDE = new Set(["new_recording", "class_reminder", "announcement"]);

type Recipient = { id: string; name: string };

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });

  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) {
      return json({ error: "Notification service is not configured" }, 500);
    }

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: { user } } = await svc.auth.getUser(token);
    if (!user) return json({ error: "Invalid session" }, 401);

    const { data: me, error: meError } = await svc
      .from("profiles")
      .select("role,welcome_sent_at")
      .eq("id", user.id)
      .single();
    if (meError) return json({ error: meError.message }, 500);

    const payload = await req.json();
    const { type, student_id, batch_id, title, message } = payload;
    if (!T[type]) return json({ error: "Unknown notification type" }, 400);

    const role = me?.role ?? "student";
    const isAdmin = role === "admin";
    const isOwnWelcome = type === "welcome" && student_id === user.id && !me?.welcome_sent_at;

    let allowed = (isAdmin && ADMIN_TYPES.has(type)) || isOwnWelcome;
    if (!allowed && role === "teacher" && TEACHER_TYPES.has(type) && batch_id) {
      const { data: batch } = await svc.from("batches").select("teacher_id").eq("id", batch_id).single();
      allowed = batch?.teacher_id === user.id;
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    if ((BATCH_WIDE.has(type) || type === "enrolment_paid" || type === "payment_reminder") && !batch_id) {
      return json({ error: "batch_id is required" }, 400);
    }
    if ((type === "welcome" || type === "enrolment_paid" || type === "payment_reminder") && !student_id) {
      return json({ error: "student_id is required" }, 400);
    }
    if (type === "announcement" && !message) return json({ error: "message is required" }, 400);

    let batch: { name?: string; schedule?: string; fee?: number } = {};
    if (batch_id) {
      const { data } = await svc.from("batches").select("name,schedule,fee").eq("id", batch_id).single();
      batch = data ?? {};
    }

    let recipients: Recipient[] = [];
    if (student_id) {
      const { data } = await svc.from("profiles").select("id,full_name").eq("id", student_id).single();
      if (data) recipients = [{ id: data.id, name: data.full_name }];
    } else if (BATCH_WIDE.has(type) && batch_id) {
      const { data: enrollments } = await svc
        .from("enrollments")
        .select("student_id")
        .eq("batch_id", batch_id)
        .eq("payment_status", "paid");
      const ids = (enrollments ?? []).map((e) => e.student_id);
      if (ids.length) {
        const { data: profiles } = await svc.from("profiles").select("id,full_name").in("id", ids);
        recipients = (profiles ?? []).map((profile) => ({ id: profile.id, name: profile.full_name }));
      }
    }
    if (!recipients.length) return json({ error: "No recipients" }, 400);

    let sent = 0;
    const failures: string[] = [];

    for (const recipient of recipients) {
      const { data: authUser } = await svc.auth.admin.getUserById(recipient.id);
      const email = authUser?.user?.email;
      if (!email) {
        failures.push(`${recipient.name} (no email)`);
        continue;
      }

      const { subject, html } = T[type]({
        name: recipient.name,
        batch: batch.name,
        schedule: batch.schedule,
        fee: batch.fee,
        title,
        message,
      });
      const result = await sendEmail(RESEND_API_KEY, FROM, email, subject, html);
      if (result.ok) sent++;
      else failures.push(`${email}: ${result.error}`);
    }

    if (type === "welcome" && student_id === user.id && sent > 0) {
      await svc.from("profiles").update({ welcome_sent_at: new Date().toISOString() }).eq("id", user.id);
    }

    return json({ ok: sent > 0, sent, total: recipients.length, failures });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
