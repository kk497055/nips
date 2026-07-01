// NIPS Portal — notification suite (Resend)
// One endpoint, many notification types. Verifies the caller, resolves
// recipient emails server-side, renders a branded template, sends via Resend.
// Secrets (RESEND_API_KEY, NOTIFY_FROM) live in Supabase, never the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const PORTAL = "https://nips.com.pk/portal/login.html";
const PHONE = "+92 321 5554125";
const ADDRESS = "K Block, Johar Town, Lahore";

// ---------- shared branded layout ----------
function layout(opts: { preheader: string; heading: string; body: string; cta?: { label: string; url: string } }) {
  const cta = opts.cta
    ? `<tr><td style="padding:8px 0 4px"><a href="${opts.cta.url}" style="display:inline-block;background:#f4a020;color:#3a2a06;text-decoration:none;padding:13px 26px;border-radius:8px;font-weight:bold;font-size:15px">${opts.cta.label}</a></td></tr>`
    : "";
  return `<!DOCTYPE html><html><body style="margin:0;background:#f5f7f6;padding:24px 12px;font-family:Arial,Helvetica,sans-serif;color:#1a1a1a">
  <span style="display:none;max-height:0;overflow:hidden;opacity:0">${opts.preheader}</span>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;margin:0 auto;background:#fff;border-radius:14px;overflow:hidden;border:1px solid #e5e7eb">
    <tr><td style="background:#1a5336;padding:22px 28px">
      <span style="color:#fff;font-size:20px;font-weight:bold;letter-spacing:.3px">NIPS Education Solutions</span>
      <div style="color:#9fe1cb;font-size:11px;letter-spacing:.14em;text-transform:uppercase;margin-top:3px">Dream · Connect · Achieve</div>
    </td></tr>
    <tr><td style="padding:28px">
      <h1 style="margin:0 0 14px;font-size:20px;color:#1a5336">${opts.heading}</h1>
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:15px;line-height:1.6;color:#374151">
        ${opts.body}
        ${cta}
      </table>
    </td></tr>
    <tr><td style="padding:16px 28px;background:#f5f7f6;border-top:1px solid #e5e7eb">
      <p style="margin:0;color:#6b7280;font-size:12px;line-height:1.7">
        Need help? Reply to this email or call ${PHONE}.<br>
        © 2026 NIPS Education Solutions SMC (Pvt) Ltd · ${ADDRESS}
      </p>
    </td></tr>
  </table></body></html>`;
}
const p = (t: string) => `<tr><td style="padding:0 0 12px">${t}</td></tr>`;

// ---------- templates ----------
type Ctx = { name: string; batch?: string; schedule?: string; fee?: number; title?: string; url?: string; message?: string };
const T: Record<string, (c: Ctx) => { subject: string; html: string }> = {
  welcome: (c) => ({
    subject: "Welcome to the NIPS Portal",
    html: layout({
      preheader: "Your NIPS learning portal account is ready.",
      heading: `Welcome, ${c.name} 👋`,
      body: p("Your account on the NIPS learning portal is ready. This is where your live classes, recorded lessons, and schedule will live.") +
            p("Once our team confirms your enrolment and payment, your classes will appear on your dashboard."),
      cta: { label: "Open the Portal", url: PORTAL },
    }),
  }),
  enrolment_paid: (c) => ({
    subject: `You're enrolled — ${c.batch}`,
    html: layout({
      preheader: `Your enrolment in ${c.batch} is confirmed.`,
      heading: "Enrolment confirmed 🎉",
      body: p(`Dear ${c.name},`) +
            p(`Your enrolment in <strong>${c.batch}</strong> is confirmed and your payment has been received.`) +
            p(`<strong>Schedule:</strong> ${c.schedule || "To be announced"}`) +
            p("You can now join your live classes and watch recordings from the portal."),
      cta: { label: "Go to My Classes", url: PORTAL },
    }),
  }),
  payment_reminder: (c) => ({
    subject: `Payment pending — ${c.batch}`,
    html: layout({
      preheader: `A quick reminder about your ${c.batch} fee.`,
      heading: "Payment reminder",
      body: p(`Dear ${c.name},`) +
            p(`This is a friendly reminder that your fee for <strong>${c.batch}</strong>${c.fee ? ` (PKR ${c.fee.toLocaleString()})` : ""} is still pending.`) +
            p("Once your payment is confirmed by our team, your access to live classes will be unlocked right away."),
      cta: { label: "View Details", url: PORTAL },
    }),
  }),
  new_recording: (c) => ({
    subject: `New recording — ${c.batch}`,
    html: layout({
      preheader: `A new session recording is available for ${c.batch}.`,
      heading: "New recording available 🎥",
      body: p(`Dear ${c.name},`) +
            p(`A new recording${c.title ? ` — <strong>${c.title}</strong>` : ""} has been added to <strong>${c.batch}</strong>.`) +
            p("You can watch it anytime from your dashboard."),
      cta: { label: "Watch Now", url: PORTAL },
    }),
  }),
  class_reminder: (c) => ({
    subject: `Class reminder — ${c.batch}`,
    html: layout({
      preheader: `Your ${c.batch} class is coming up.`,
      heading: "Your class is coming up ⏰",
      body: p(`Dear ${c.name},`) +
            p(`This is a reminder for your upcoming <strong>${c.batch}</strong> class.`) +
            p(`<strong>Schedule:</strong> ${c.schedule || "See the portal"}`) +
            p("Join a few minutes early so you're ready to start on time."),
      cta: { label: "Join Class", url: PORTAL },
    }),
  }),
  announcement: (c) => ({
    subject: c.title || "A note from NIPS",
    html: layout({
      preheader: c.title || "A note from NIPS Education Solutions.",
      heading: c.title || "Announcement",
      body: p(`Dear ${c.name},`) + p((c.message || "").replace(/\n/g, "<br>")),
      cta: { label: "Open the Portal", url: PORTAL },
    }),
  }),
};

// admin-only types vs teacher-allowed
const ADMIN_TYPES = new Set(["welcome", "enrolment_paid", "payment_reminder", "class_reminder", "announcement"]);
const TEACHER_TYPES = new Set(["new_recording", "class_reminder"]);
const BATCH_WIDE = new Set(["new_recording", "class_reminder", "announcement"]); // may target whole batch

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: { user } } = await svc.auth.getUser(token);
    if (!user) return json({ error: "Invalid session" }, 401);
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
    const role = me?.role ?? "student";

    const { type, student_id, batch_id, title, message } = await req.json();
    if (!T[type]) return json({ error: "Unknown notification type" }, 400);

    // Authorisation.
    const isAdmin = role === "admin";
    let allowed = isAdmin && ADMIN_TYPES.has(type);
    if (!allowed && role === "teacher" && TEACHER_TYPES.has(type) && batch_id) {
      const { data: b } = await svc.from("batches").select("teacher_id").eq("id", batch_id).single();
      allowed = b?.teacher_id === user.id;
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    // Resolve batch context.
    let batch: { name?: string; schedule?: string; fee?: number } = {};
    if (batch_id) {
      const { data } = await svc.from("batches").select("name,schedule,fee").eq("id", batch_id).single();
      batch = data ?? {};
    }

    // Resolve recipients: a single student, or all paid students of a batch.
    let recipients: { id: string; name: string }[] = [];
    if (student_id) {
      const { data } = await svc.from("profiles").select("id,full_name").eq("id", student_id).single();
      if (data) recipients = [{ id: data.id, name: data.full_name }];
    } else if (BATCH_WIDE.has(type) && batch_id) {
      const { data: enr } = await svc.from("enrollments").select("student_id").eq("batch_id", batch_id).eq("payment_status", "paid");
      const ids = (enr ?? []).map((e) => e.student_id);
      if (ids.length) {
        const { data: profs } = await svc.from("profiles").select("id,full_name").in("id", ids);
        recipients = (profs ?? []).map((x) => ({ id: x.id, name: x.full_name }));
      }
    }
    if (!recipients.length) return json({ error: "No recipients" }, 400);

    // Send one email per recipient (keeps addresses private).
    let sent = 0; const failures: string[] = [];
    for (const r of recipients) {
      const { data: au } = await svc.auth.admin.getUserById(r.id);
      const email = au?.user?.email;
      if (!email) { failures.push(r.name + " (no email)"); continue; }
      const { subject, html } = T[type]({
        name: r.name, batch: batch.name, schedule: batch.schedule, fee: batch.fee, title, url: PORTAL, message,
      });
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: FROM, to: [email], subject, html }),
      });
      if (res.ok) sent++;
      else { const b = await res.json().catch(() => ({})); failures.push(`${email}: ${b.message || res.status}`); }
    }

    return json({ ok: sent > 0, sent, total: recipients.length, failures });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
