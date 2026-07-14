// NIPS Portal - notification suite (Resend)
// Verifies the caller, resolves recipient emails server-side, renders the
// branded template, and sends one email per recipient.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import { layout, T, sendEmail } from "../_shared/templates.ts";

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
const ADMIN_TYPES = new Set(["welcome", "enrolment_paid", "payment_reminder", "class_reminder", "announcement", "payment_receipt"]);
const TEACHER_TYPES = new Set(["new_recording", "class_reminder"]);
const BATCH_WIDE = new Set(["new_recording", "class_reminder", "announcement"]);

type Recipient = { id: string; name: string };

const pkr = (amount: number) => `PKR ${Math.round(Number(amount) || 0).toLocaleString()}`;
const safePdfText = (value: unknown, max = 76) => String(value ?? "-")
  .replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7E]/g, "?").slice(0, max);
const b64 = (bytes: Uint8Array) => {
  let text = "";
  for (let i = 0; i < bytes.length; i += 8192) text += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(text);
};

async function receiptPdf(receipt: { number: string; student: string; batch: string; amount: number; paidOn: string; note?: string | null }) {
  const pdf = await PDFDocument.create();
  const page = pdf.addPage([595.28, 841.89]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const green = rgb(0.102, 0.325, 0.212);
  const amber = rgb(0.957, 0.627, 0.125);
  const muted = rgb(0.42, 0.45, 0.5);
  page.drawRectangle({ x: 0, y: 716, width: 595.28, height: 125.89, color: green });
  page.drawText("NIPS EDUCATION SOLUTION", { x: 44, y: 782, size: 22, font: bold, color: rgb(1, 1, 1) });
  page.drawText("SMC (Pvt) Ltd.", { x: 44, y: 757, size: 13, font: regular, color: rgb(0.78, 0.9, 0.84) });
  page.drawText("PAYMENT RECEIPT", { x: 374, y: 775, size: 13, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 44, y: 635, width: 507, height: 52, color: rgb(0.96, 0.97, 0.96), borderColor: rgb(0.9, 0.91, 0.91), borderWidth: 1 });
  page.drawText("Receipt number", { x: 60, y: 663, size: 10, font: bold, color: muted });
  page.drawText(safePdfText(receipt.number), { x: 60, y: 645, size: 13, font: bold, color: green });
  page.drawText("Date received", { x: 355, y: 663, size: 10, font: bold, color: muted });
  page.drawText(new Date(receipt.paidOn).toLocaleDateString("en-GB"), { x: 355, y: 645, size: 13, font: bold, color: green });
  const rows = [["Student", receipt.student], ["Batch / subject", receipt.batch], ["Payment note", receipt.note || "Course fee"]];
  let y = 584;
  for (const [label, value] of rows) {
    page.drawText(label, { x: 60, y, size: 11, font: bold, color: muted });
    page.drawText(safePdfText(value), { x: 205, y, size: 12, font: regular, color: rgb(0.1, 0.1, 0.1) });
    page.drawLine({ start: { x: 60, y: y - 14 }, end: { x: 535, y: y - 14 }, thickness: 0.6, color: rgb(0.9, 0.91, 0.91) });
    y -= 52;
  }
  page.drawRectangle({ x: 60, y: 378, width: 475, height: 86, color: green });
  page.drawText("AMOUNT RECEIVED", { x: 80, y: 431, size: 11, font: bold, color: rgb(0.78, 0.9, 0.84) });
  page.drawText(pkr(receipt.amount), { x: 80, y: 397, size: 28, font: bold, color: rgb(1, 1, 1) });
  page.drawRectangle({ x: 60, y: 336, width: 82, height: 4, color: amber });
  page.drawText("Thank you for choosing NIPS Education Solution (SMC-Pvt) Ltd.", { x: 60, y: 294, size: 11, font: regular, color: muted });
  page.drawText("K Block, Johar Town, Lahore | +92 321 5554125", { x: 60, y: 270, size: 10, font: regular, color: muted });
  page.drawText("This is a system-generated receipt.", { x: 60, y: 226, size: 9, font: regular, color: muted });
  return b64(await pdf.save());
}

async function teachesBatch(svc: any, batchId: string, teacherId: string) {
  const { data: batch } = await svc.from("batches").select("teacher_id").eq("id", batchId).single();
  if (batch?.teacher_id === teacherId) return true;
  const { data: coTeacher } = await svc
    .from("batch_teachers")
    .select("id")
    .eq("batch_id", batchId)
    .eq("teacher_id", teacherId)
    .maybeSingle();
  return !!coTeacher;
}

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
    const { type, student_id, batch_id, payment_id, title, message } = payload;
    if (!T[type] && type !== "payment_receipt") return json({ error: "Unknown notification type" }, 400);

    const role = me?.role ?? "student";
    const isAdmin = role === "admin";
    const isOwnWelcome = type === "welcome" && student_id === user.id && !me?.welcome_sent_at;

    let allowed = (isAdmin && ADMIN_TYPES.has(type)) || isOwnWelcome;
    if (!allowed && role === "teacher" && TEACHER_TYPES.has(type) && batch_id) {
      allowed = await teachesBatch(svc, batch_id, user.id);
    }
    if (!allowed) return json({ error: "Forbidden" }, 403);

    if ((BATCH_WIDE.has(type) || type === "enrolment_paid" || type === "payment_reminder") && !batch_id) {
      return json({ error: "batch_id is required" }, 400);
    }
    if ((type === "welcome" || type === "enrolment_paid" || type === "payment_reminder") && !student_id) {
      return json({ error: "student_id is required" }, 400);
    }
    if (type === "announcement" && !message) return json({ error: "message is required" }, 400);
    if (type === "payment_receipt" && !payment_id) return json({ error: "payment_id is required" }, 400);

    if (type === "payment_receipt") {
      const { data: payment, error: paymentError } = await svc
        .from("payments")
        .select("id,student_id,batch_id,amount,note,paid_on,receipt_number")
        .eq("id", payment_id)
        .single();
      if (paymentError || !payment) return json({ error: paymentError?.message || "Payment not found" }, 404);
      const { data: student } = await svc.from("profiles").select("full_name").eq("id", payment.student_id).single();
      const { data: paymentBatch } = payment.batch_id
        ? await svc.from("batches").select("name").eq("id", payment.batch_id).single()
        : { data: null };
      const { data: authUser } = await svc.auth.admin.getUserById(payment.student_id);
      const email = authUser?.user?.email;
      if (!email) return json({ error: "Student has no email address" }, 400);
      const receiptNumber = payment.receipt_number || `NIPS-${new Date(payment.paid_on).toISOString().slice(0, 10).replaceAll("-", "")}-${payment.id.slice(0, 8).toUpperCase()}`;
      if (!payment.receipt_number) {
        const { error: updateError } = await svc.from("payments").update({ receipt_number: receiptNumber }).eq("id", payment.id);
        if (updateError) return json({ error: updateError.message }, 500);
      }
      const pdf = await receiptPdf({
        number: receiptNumber,
        student: student?.full_name || "Student",
        batch: paymentBatch?.name || "NIPS course",
        amount: Number(payment.amount),
        paidOn: payment.paid_on,
        note: payment.note,
      });
      const html = layout({
        preheader: `Your NIPS receipt ${receiptNumber} is attached.`,
        heading: "Payment receipt",
        body: `<tr><td style="padding:0 0 12px">Dear ${student?.full_name || "Student"},</td></tr>` +
          `<tr><td style="padding:0 0 12px">We have received <strong>${pkr(Number(payment.amount))}</strong> for <strong>${paymentBatch?.name || "your NIPS course"}</strong>.</td></tr>` +
          `<tr><td style="padding:0 0 12px">Receipt <strong>${receiptNumber}</strong> is attached for your records.</td></tr>`,
      });
      const result = await sendEmail(RESEND_API_KEY, FROM, email, `Payment receipt ${receiptNumber}`, html, {
        bcc: ["kashif@nips.com.pk"],
        attachments: [{ filename: `${receiptNumber}.pdf`, content: pdf }],
      });
      if (!result.ok) return json({ error: result.error }, 502);
      await svc.from("payments").update({ receipt_sent_at: new Date().toISOString() }).eq("id", payment.id);
      return json({ ok: true, sent: 1, total: 1, receipt_number: receiptNumber });
    }

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
