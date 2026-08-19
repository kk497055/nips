// NIPS Portal — shared email templates (used by notify + class-reminders).

const PORTAL = "https://nips.com.pk/portal/login.html";
const PHONE = "+92 321 5554125";
const ADDRESS = "K Block, Johar Town, Lahore";
export const ORIENTATION_CONFIRMATION_TEXT = "Please confirm receipt of this email and your orientation registration by contacting us at 03137840005.";

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
  orientation_scheduled: (c) => ({
    subject: `Orientation schedule confirmed — ${c.batch}`,
    html: layout({
      preheader: `${c.batch} is scheduled for ${c.schedule}.`,
      heading: "Your orientation is scheduled",
      body: p(`Dear ${c.name},`) +
            p(`Your place in <strong>${c.batch}</strong> is confirmed.`) +
            p(`<strong>Date and time:</strong> ${c.schedule || "See the portal"}`) +
            (c.message ? p(c.message) : "") +
            p(`<strong>${ORIENTATION_CONFIRMATION_TEXT}</strong>`) +
            p("Please sign in to the NIPS Portal before the session. The Google Meet button will appear there when the orientation goes live."),
      cta: { label: "View Orientation Details", url: PORTAL },
    }),
  }),
  orientation_study_mode_request: (c) => ({
    subject: "Choose your preferred study mode — NIPS",
    html: layout({
      preheader: "Tell NIPS whether you prefer online or physical classes.",
      heading: "How would you prefer to study?",
      body: p(`Dear ${c.name},`) +
            p("Please choose whether you would prefer to attend your <strong>regular course after orientation</strong> online or physically/on campus.") +
            p("This choice does not change your orientation registration or access. You can update it later from your NIPS Portal account."),
      cta: { label: "Choose Study Mode", url: "https://nips.com.pk/portal/student.html?view=home#study-mode-preference" },
    }),
  }),
  orientation_reminder: (c) => ({
    subject: `Reminder — ${c.batch}`,
    html: layout({
      preheader: `${c.batch} starts ${c.title || "soon"}.`,
      heading: `Orientation starts ${c.title || "soon"}`,
      body: p(`Dear ${c.name},`) +
            p(`This is a reminder that <strong>${c.batch}</strong> is scheduled for <strong>${c.schedule || "the announced time"}</strong>.`) +
            (c.message ? p(c.message) : "") +
            p("Please sign in early. The Google Meet button will appear in the portal when the session goes live."),
      cta: { label: "Open the Portal", url: PORTAL },
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
type EmailOptions = { bcc?: string[]; attachments?: EmailAttachment[]; replyTo?: string };

type GmailConfig = {
  clientId: string;
  clientSecret: string;
  refreshToken: string;
  fromEmail: string;
};

let gmailAccessToken = "";
let gmailAccessTokenExpiresAt = 0;

function env(name: string) {
  return typeof Deno !== "undefined" ? Deno.env.get(name) || "" : "";
}

function gmailConfig(): GmailConfig | null {
  const config = {
    clientId: env("GOOGLE_OAUTH_CLIENT_ID"),
    clientSecret: env("GOOGLE_OAUTH_CLIENT_SECRET"),
    refreshToken: env("GOOGLE_OAUTH_REFRESH_TOKEN"),
    fromEmail: env("GOOGLE_FROM_EMAIL"),
  };
  return Object.values(config).every(Boolean) ? config : null;
}

function encodeBase64(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  }
  return btoa(binary);
}

function wrapBase64(value: string) {
  return value.match(/.{1,76}/g)?.join("\r\n") || "";
}

function header(value: string) {
  return value.replace(/[\r\n]+/g, " ").trim();
}

function encodedHeader(value: string) {
  return `=?UTF-8?B?${encodeBase64(header(value))}?=`;
}

async function getGmailAccessToken(config: GmailConfig) {
  if (gmailAccessToken && Date.now() < gmailAccessTokenExpiresAt - 60_000) return gmailAccessToken;
  const response = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: config.clientId,
      client_secret: config.clientSecret,
      refresh_token: config.refreshToken,
      grant_type: "refresh_token",
    }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok || !body.access_token) throw new Error(body.error_description || body.error || `Google OAuth ${response.status}`);
  gmailAccessToken = body.access_token;
  gmailAccessTokenExpiresAt = Date.now() + Number(body.expires_in || 3600) * 1000;
  return gmailAccessToken;
}

function gmailRawMessage(
  from: string,
  to: string,
  subject: string,
  html: string,
  opts: EmailOptions,
) {
  const replyTo = opts.replyTo || env("NOTIFY_REPLY_TO");
  const common = [
    `From: ${header(from)}`,
    `To: ${header(to)}`,
    ...(replyTo ? [`Reply-To: ${header(replyTo)}`] : []),
    ...(opts.bcc?.length ? [`Bcc: ${opts.bcc.map(header).join(", ")}`] : []),
    `Subject: ${encodedHeader(subject)}`,
    "MIME-Version: 1.0",
  ];
  if (!opts.attachments?.length) {
    return [...common, "Content-Type: text/html; charset=UTF-8", "Content-Transfer-Encoding: base64", "", wrapBase64(encodeBase64(html))].join("\r\n");
  }

  const boundary = `nips_${crypto.randomUUID().replaceAll("-", "")}`;
  const parts = [
    ...common,
    `Content-Type: multipart/mixed; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    wrapBase64(encodeBase64(html)),
  ];
  for (const attachment of opts.attachments) {
    const filename = header(attachment.filename).replaceAll('"', "'");
    parts.push(
      `--${boundary}`,
      `Content-Type: application/octet-stream; name="${filename}"`,
      "Content-Transfer-Encoding: base64",
      `Content-Disposition: attachment; filename="${filename}"`,
      "",
      wrapBase64(attachment.content.replace(/\s/g, "")),
    );
  }
  parts.push(`--${boundary}--`, "");
  return parts.join("\r\n");
}

async function sendWithGmail(
  config: GmailConfig,
  from: string,
  to: string,
  subject: string,
  html: string,
  opts: EmailOptions,
) {
  const displayName = from.match(/^\s*([^<]+?)\s*</)?.[1]?.trim() || "NIPS Education Solutions";
  const raw = gmailRawMessage(`${header(displayName)} <${header(config.fromEmail)}>`, to, subject, html, opts);
  const token = await getGmailAccessToken(config);
  const response = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify({ raw: encodeBase64(raw).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "") }),
  });
  if (response.ok) return { ok: true, provider: "gmail" };
  const body = await response.json().catch(() => ({}));
  return { ok: false, error: body.error?.message || `Gmail API ${response.status}` };
}

export async function sendEmail(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
  opts: EmailOptions = {},
) {
  const google = gmailConfig();
  if (google) {
    try {
      const result = await sendWithGmail(google, from, to, subject, html, opts);
      if (result.ok) return result;
      console.error(`Gmail delivery failed; using Resend fallback: ${result.error}`);
    } catch (error) {
      console.error(`Gmail delivery failed; using Resend fallback: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      from,
      to: [to],
      subject,
      html,
      reply_to: opts.replyTo || env("NOTIFY_REPLY_TO") || undefined,
      bcc: opts.bcc,
      attachments: opts.attachments,
    }),
  });
  if (res.ok) return { ok: true, provider: "resend" };
  const b = await res.json().catch(() => ({}));
  return { ok: false, error: b.message || String(res.status) };
}
