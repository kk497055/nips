import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { PDFDocument, StandardFonts, rgb } from "https://esm.sh/pdf-lib@1.17.1";
import QRCode from "https://esm.sh/qrcode@1.5.4";

const cors = { "Access-Control-Allow-Origin": "*", "Access-Control-Allow-Headers": "authorization, content-type" };
const clean = (value: unknown, max = 160) => String(value ?? "").replace(/[\r\n]+/g, " ").replace(/[^\x20-\x7E]/g, "").slice(0, max);
const center = (page: any, text: string, y: number, font: any, size: number, color: any) => {
  const width = font.widthOfTextAtSize(text, size); page.drawText(text, { x: (841.89 - width) / 2, y, font, size, color });
};

Deno.serve(async req => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  const code = new URL(req.url).searchParams.get("code") || "";
  if (!/^[a-f0-9]{32}$/i.test(code)) return new Response("Certificate not found", { status: 404, headers: cors });
  const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
  const { data: cert } = await svc.from("certificates").select("*,profiles!certificates_student_id_fkey(full_name)").eq("verification_code", code).single();
  if (!cert || cert.revoked_at) return new Response("Certificate is unavailable", { status: 404, headers: cors });

  const pdf = await PDFDocument.create();
  const page = pdf.addPage([841.89, 595.28]);
  const regular = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const italic = await pdf.embedFont(StandardFonts.HelveticaOblique);
  const green = rgb(0.07, 0.29, 0.18), gold = rgb(0.86, 0.58, 0.13), ink = rgb(0.12, 0.13, 0.15), muted = rgb(0.38, 0.41, 0.46);
  page.drawRectangle({ x: 18, y: 18, width: 805.89, height: 559.28, borderColor: green, borderWidth: 4 });
  page.drawRectangle({ x: 28, y: 28, width: 785.89, height: 539.28, borderColor: gold, borderWidth: 1.5 });
  try {
    const logoBytes = new Uint8Array(await (await fetch("https://nips.com.pk/assets/nips-logo-transparent-v2.png")).arrayBuffer());
    const logo = await pdf.embedPng(logoBytes);
    const logoDims = logo.scaleToFit(59, 59);
    page.drawImage(logo, { x: 61, y: 475, width: logoDims.width, height: logoDims.height });
  } catch (_) { /* certificate remains valid if the public logo is temporarily unavailable */ }
  page.drawText("NIPS EDUCATION SOLUTIONS", { x: 132, y: 512, size: 20, font: bold, color: green });
  const isIac = cert.institution.toLowerCase().includes("arts") || cert.program.toLowerCase().includes("arts");
  if (isIac) page.drawText("INSTITUTE OF ARTS & CULTURE", { x: 133, y: 494, size: 10, font: bold, color: gold });
  page.drawText("DREAM  |  CONNECT  |  ACHIEVE", { x: 133, y: 479, size: 8, font: regular, color: muted });
  const certificateLabel = clean(cert.certificate_number, 60);
  page.drawText(certificateLabel, { x: 780 - regular.widthOfTextAtSize(certificateLabel, 8), y: 510, size: 8, font: regular, color: muted });
  center(page, "CERTIFICATE OF COMPLETION", 432, bold, 29, ink);
  center(page, "This certificate is proudly presented to", 400, italic, 13, muted);
  center(page, clean(cert.profiles?.full_name || "Student"), 350, bold, 31, green);
  page.drawLine({ start: { x: 205, y: 339 }, end: { x: 637, y: 339 }, thickness: 1, color: gold });
  center(page, `Son / daughter of ${clean(cert.father_name)}`, 318, regular, 12, muted);
  center(page, "for successfully completing", 293, regular, 13, muted);
  center(page, clean(cert.course), 258, bold, 23, ink);
  center(page, `${clean(cert.program)}  |  Duration: ${clean(cert.duration)}`, 230, regular, 13, muted);
  center(page, `Completed on ${new Date(cert.completion_date + "T00:00:00Z").toLocaleDateString("en-GB", { day:"numeric", month:"long", year:"numeric", timeZone:"UTC" })}`, 206, regular, 12, muted);

  if (cert.signature_url) {
    try {
      const bytes = new Uint8Array(await (await fetch(cert.signature_url)).arrayBuffer());
      const image = cert.signature_url.toLowerCase().includes("png") ? await pdf.embedPng(bytes) : await pdf.embedJpg(bytes);
      const dims = image.scaleToFit(190, 66); page.drawImage(image, { x: 145 + (190 - dims.width) / 2, y: 105, width: dims.width, height: dims.height });
    } catch (_) { /* retain signature line and signer identity */ }
  }
  page.drawLine({ start: { x: 145, y: 102 }, end: { x: 335, y: 102 }, thickness: 0.8, color: ink });
  center(page, "", 0, regular, 1, ink);
  const signer = clean(cert.signer_name); page.drawText(signer, { x: 240 - bold.widthOfTextAtSize(signer, 11) / 2, y: 88, size: 11, font: bold, color: ink });
  const title = clean(cert.signer_title); page.drawText(title, { x: 240 - regular.widthOfTextAtSize(title, 9) / 2, y: 73, size: 9, font: regular, color: muted });

  const verifyUrl = `https://nips.com.pk/verify-certificate.html?code=${code}`;
  const qrData = await QRCode.toDataURL(verifyUrl, { margin: 0, width: 180, color: { dark: "#123f29", light: "#ffffff" } });
  const qr = await pdf.embedPng(Uint8Array.from(atob(qrData.split(",")[1]), c => c.charCodeAt(0)));
  page.drawImage(qr, { x: 660, y: 70, width: 88, height: 88 });
  page.drawText("Scan to verify", { x: 672, y: 55, size: 8, font: bold, color: green });
  page.drawText(clean(cert.certificate_number), { x: 48, y: 48, size: 8, font: regular, color: muted });
  page.drawText("nips.com.pk", { x: 743, y: 48, size: 8, font: regular, color: muted });
  const bytes = await pdf.save();
  return new Response(bytes, { headers: { ...cors, "Content-Type": "application/pdf", "Content-Disposition": `inline; filename="${clean(cert.certificate_number, 60)}.pdf"`, "Cache-Control": "private, max-age=300" } });
});
