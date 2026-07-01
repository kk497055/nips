// NIPS Portal — notification sender (Resend)
// Called by the admin console after enrolling+marking a student paid.
// Verifies the caller is an admin, looks up the recipient email server-side,
// and sends a branded email via Resend. RESEND_API_KEY stays in Supabase.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

const FROM = Deno.env.get("NOTIFY_FROM") || "NIPS Portal <noreply@nips.com.pk>";
const PORTAL_URL = "https://nips.com.pk/portal/login.html";

function enrolmentEmail(name: string, batch: string, schedule: string) {
  return {
    subject: `You're enrolled — ${batch}`,
    html: `
      <div style="font-family:Arial,sans-serif;max-width:520px;margin:0 auto;color:#1a1a1a">
        <div style="background:#1a5336;color:#fff;padding:20px 24px;border-radius:12px 12px 0 0">
          <h2 style="margin:0;font-size:20px">NIPS Education Solutions</h2>
        </div>
        <div style="border:1px solid #e5e7eb;border-top:none;padding:24px;border-radius:0 0 12px 12px">
          <p>Dear ${name},</p>
          <p>Your enrolment in <strong>${batch}</strong> is confirmed and your payment has been received. 🎉</p>
          <p><strong>Schedule:</strong> ${schedule || "To be announced"}</p>
          <p>You can now join your live classes and view recordings from the NIPS Portal:</p>
          <p style="text-align:center;margin:24px 0">
            <a href="${PORTAL_URL}" style="background:#f4a020;color:#3a2a06;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:bold">Open the Portal</a>
          </p>
          <p style="color:#6b7280;font-size:13px">If you have any questions, reply to this email or contact us at +92 321 5554125.</p>
        </div>
        <p style="color:#9ca3af;font-size:11px;text-align:center;margin-top:14px">
          © 2026 NIPS Education Solutions SMC (Pvt) Ltd · K Block, Johar Town, Lahore
        </p>
      </div>`,
  };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const RESEND_API_KEY = Deno.env.get("RESEND_API_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: { user } } = await svc.auth.getUser(token);
    if (!user) return json({ error: "Invalid session" }, 401);

    // Only admins may trigger notifications.
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "Forbidden" }, 403);

    const { type, student_id, batch_id } = await req.json();
    if (type !== "enrolment_paid") return json({ error: "Unknown notification type" }, 400);

    const { data: student } = await svc.from("profiles").select("full_name").eq("id", student_id).single();
    const { data: authUser } = await svc.auth.admin.getUserById(student_id);
    const email = authUser?.user?.email;
    if (!email) return json({ error: "Student has no email" }, 400);

    const { data: batch } = await svc.from("batches").select("name,schedule").eq("id", batch_id).single();
    const { subject, html } = enrolmentEmail(student?.full_name ?? "Student", batch?.name ?? "your class", batch?.schedule ?? "");

    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: { Authorization: `Bearer ${RESEND_API_KEY}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: FROM, to: [email], subject, html }),
    });
    const body = await res.json();
    if (!res.ok) return json({ error: "Resend: " + (body.message || res.status) }, 502);

    return json({ ok: true, id: body.id, sentTo: email });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
