// NIPS Portal — shared email templates (used by notify + class-reminders).

const PORTAL = "https://nips.com.pk/portal/login.html";
const PHONE = "+92 321 5554125";
const ADDRESS = "K Block, Johar Town, Lahore";

export function layout(opts: { preheader: string; heading: string; body: string; cta?: { label: string; url: string } }) {
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

export type Ctx = { name: string; batch?: string; schedule?: string; fee?: number; title?: string; message?: string };

export const T: Record<string, (c: Ctx) => { subject: string; html: string }> = {
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
    subject: `Class today — ${c.batch}`,
    html: layout({
      preheader: `You have a ${c.batch} class today.`,
      heading: "You have a class today ⏰",
      body: p(`Dear ${c.name},`) +
            p(`This is a reminder that your <strong>${c.batch}</strong> class is scheduled for today.`) +
            p(`<strong>Timing:</strong> ${c.schedule || "See the portal"}`) +
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

export type EmailAttachment = { filename: string; content: string };

export async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  opts: { bcc?: string[]; attachments?: EmailAttachment[] } = {},
) {
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from, to: [to], subject, html, bcc: opts.bcc, attachments: opts.attachments }),
  });
  if (res.ok) return { ok: true };
  const b = await res.json().catch(() => ({}));
  return { ok: false, error: b.message || String(res.status) };
}
