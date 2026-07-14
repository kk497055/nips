// NIPS Portal — monthly fee collection and dunning
// Run daily by Supabase Cron. Invoices are generated per enabled batch, then
// transition from pending -> grace -> delinquent. Delinquency pauses only live
// class access (enforced by jaas-token), not general portal content.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { layout, sendEmail } from "../_shared/templates.ts";

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const TIME_ZONE = "Asia/Karachi";
const GRACE_DAYS = 7;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

function localDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((part) => part.type === type)?.value ?? "";
  return `${get("year")}-${get("month")}-${get("day")}`;
}
function addDays(date: string, days: number) {
  const d = new Date(`${date}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}
function monthStart(date: string) { return `${date.slice(0, 7)}-01`; }
function nextMonthStart(date: string) {
  const d = new Date(`${monthStart(date)}T12:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + 1);
  return d.toISOString().slice(0, 10);
}
const pkr = (amount: number) => `PKR ${Math.round(Number(amount) || 0).toLocaleString()}`;
const agreedAmount = (enrollment: any, batchFee: number) => {
  const amount = Number(enrollment?.amount);
  return Number.isFinite(amount) && (amount > 0 || enrollment?.discount_note) ? amount : Number(batchFee || 0);
};

function billingEmail(stage: string, student: string, batch: string, amount: number, dueDate: string, graceUntil?: string) {
  const label = stage === "due_soon" ? "Monthly fee due soon"
    : stage === "due_today" ? "Monthly fee due today"
    : stage === "overdue" ? "Monthly fee overdue"
    : "Final notice - live class access will pause";
  const extra = stage === "final"
    ? `Please pay by <strong>${graceUntil}</strong> to keep live-class access active.`
    : `Due date: <strong>${dueDate}</strong>.`;
  return {
    subject: `${label} - ${batch}`,
    html: layout({
      preheader: `${batch}: ${pkr(amount)} monthly fee reminder.`,
      heading: label,
      body: `<tr><td style="padding:0 0 12px">Dear ${student},</td></tr>` +
        `<tr><td style="padding:0 0 12px">Your monthly fee for <strong>${batch}</strong> is <strong>${pkr(amount)}</strong>.</td></tr>` +
        `<tr><td style="padding:0 0 12px">${extra}</td></tr>` +
        `<tr><td style="padding:0 0 12px">Please contact NIPS after payment so we can confirm it promptly.</td></tr>`,
    }),
  };
}

async function sendOnce(svc: any, apiKey: string, invoice: any, batchName: string, profile: any, stage: string) {
  const deliveryKey = `${invoice.id}:${stage}`;
  const { data: existing } = await svc.from("notification_logs").select("id")
    .eq("notification_type", `monthly_${stage}`).eq("batch_id", invoice.batch_id).eq("student_id", invoice.student_id).eq("delivery_key", deliveryKey).maybeSingle();
  if (existing) return { sent: false, skipped: true };
  const { data: authUser } = await svc.auth.admin.getUserById(invoice.student_id);
  const email = authUser?.user?.email;
  if (!email) return { sent: false, error: `${profile.full_name} (no email)` };
  const message = billingEmail(stage, profile.full_name, batchName, invoice.amount, invoice.due_date, invoice.grace_until);
  const result = await sendEmail(apiKey, FROM, email, message.subject, message.html);
  if (!result.ok) return { sent: false, error: `${email}: ${result.error}` };
  await svc.from("notification_logs").insert({
    notification_type: `monthly_${stage}`, batch_id: invoice.batch_id, student_id: invoice.student_id, delivery_key: deliveryKey,
  });
  return { sent: true };
}

Deno.serve(async (req) => {
  try {
    const expected = Deno.env.get("BILLING_SCHEDULE_SECRET");
    if (!expected || req.headers.get("x-schedule-secret") !== expected) return json({ error: "Forbidden" }, 403);
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY");
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
    if (!RESEND_API_KEY || !SUPABASE_URL || !SERVICE_KEY) return json({ error: "Billing service is not configured" }, 500);
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const today = localDate();
    const current = monthStart(today);
    const next = nextMonthStart(today);
    let created = 0, grace = 0, delinquent = 0, sent = 0;
    const failures: string[] = [];
    const { data: batches, error: batchError } = await svc.from("batches")
      .select("id,name,fee").eq("is_active", true).eq("monthly_billing_enabled", true);
    if (batchError) return json({ error: batchError.message }, 500);
    for (const batch of batches || []) {
      const { data: enrollments } = await svc.from("enrollments")
        .select("student_id,amount,discount_note").eq("batch_id", batch.id).in("payment_status", ["paid", "demo"]);
      for (const enrollment of enrollments || []) {
        for (const billingMonth of [current, next]) {
          const { data: existing } = await svc.from("monthly_invoices").select("id")
            .eq("batch_id", batch.id).eq("student_id", enrollment.student_id).eq("billing_month", billingMonth).maybeSingle();
          if (!existing) {
            // A payment already recorded this calendar month covers the
            // current invoice when recurring billing is enabled later.
            const { data: paidThisMonth } = billingMonth === current
              ? await svc.from("payments").select("id,paid_on").eq("batch_id", batch.id).eq("student_id", enrollment.student_id)
                .gte("paid_on", `${current}T00:00:00Z`).order("paid_on", { ascending: false }).limit(1).maybeSingle()
              : { data: null };
            const { error } = await svc.from("monthly_invoices").insert({
              batch_id: batch.id, student_id: enrollment.student_id, billing_month: billingMonth, due_date: billingMonth,
              amount: agreedAmount(enrollment, batch.fee), status: paidThisMonth ? "paid" : "pending",
              payment_id: paidThisMonth?.id || null, paid_on: paidThisMonth?.paid_on || null,
            });
            if (!error) created++;
            else failures.push(`${batch.name}: ${error.message}`);
          }
        }
      }
    }
    const { data: invoices, error: invoiceError } = await svc.from("monthly_invoices")
      .select("id,batch_id,student_id,due_date,amount,status,grace_until").in("status", ["pending", "grace", "delinquent"]);
    if (invoiceError) return json({ error: invoiceError.message }, 500);
    const batchNames = Object.fromEntries((batches || []).map((b) => [b.id, b.name]));
    const ids = [...new Set((invoices || []).map((i) => i.student_id))];
    const { data: profiles } = ids.length ? await svc.from("profiles").select("id,full_name").in("id", ids) : { data: [] };
    const profilesById = Object.fromEntries((profiles || []).map((p) => [p.id, p]));
    for (const invoice of invoices || []) {
      if (!batchNames[invoice.batch_id]) continue;
      const graceUntil = invoice.grace_until || addDays(invoice.due_date, GRACE_DAYS);
      let status = invoice.status;
      if (today > graceUntil && invoice.status !== "delinquent") {
        status = "delinquent"; delinquent++;
        await svc.from("monthly_invoices").update({ status, grace_until: graceUntil, updated_at: new Date().toISOString() }).eq("id", invoice.id);
      } else if (today > invoice.due_date && invoice.status === "pending") {
        status = "grace"; grace++;
        await svc.from("monthly_invoices").update({ status, grace_until: graceUntil, updated_at: new Date().toISOString() }).eq("id", invoice.id);
      }
      const offset = Math.round((new Date(`${today}T00:00:00Z`).getTime() - new Date(`${invoice.due_date}T00:00:00Z`).getTime()) / 86400000);
      const stage = offset === -7 ? "due_soon" : offset === 0 ? "due_today" : offset === 3 ? "overdue" : offset === GRACE_DAYS ? "final" : null;
      const profile = profilesById[invoice.student_id];
      if (stage && profile) {
        const outcome = await sendOnce(svc, RESEND_API_KEY, { ...invoice, grace_until: graceUntil }, batchNames[invoice.batch_id], profile, stage);
        if (outcome.sent) sent++;
        if (outcome.error) failures.push(outcome.error);
      }
    }
    return json({ ok: true, created, grace, delinquent, sent, failures });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
