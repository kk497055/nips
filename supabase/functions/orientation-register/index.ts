// NIPS Portal — authenticated resubmission for the IAC orientation form.
// New applicants are created by Supabase Auth on the public form; this function
// is for existing portal users and always binds data to the authenticated email.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});
const text = (value: unknown, max: number) => String(value ?? "").trim().slice(0, max);

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(url, key, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user } } = await svc.auth.getUser(token);
    if (!user?.email) return json({ error: "Please sign in before submitting the orientation form." }, 401);

    const body = await req.json();
    const data = body?.data || {};
    const payload = {
      orientation_program: "iac-orientation",
      full_name: text(data.full_name, 160), phone: text(data.phone, 50),
      date_of_birth: text(data.date_of_birth, 10), gender: text(data.gender, 60),
      city: text(data.city, 100), country: text(data.country, 100), address: text(data.address, 500),
      guardian_name: text(data.guardian_name, 160), guardian_phone: text(data.guardian_phone, 50),
      education_level: text(data.education_level, 100), institution: text(data.institution, 200),
      field_of_study: text(data.field_of_study, 160), completion_year: text(data.completion_year, 4),
      interests: text(data.interests, 1000), career_goal: text(data.career_goal, 1000),
      referral_source: text(data.referral_source, 160), notes: text(data.notes, 1000),
    };
    if (!payload.full_name || !payload.phone) return json({ error: "Full name and mobile number are required." }, 400);
    if (payload.date_of_birth && !/^\d{4}-\d{2}-\d{2}$/.test(payload.date_of_birth)) return json({ error: "Enter a valid date of birth." }, 400);
    if (payload.completion_year && !/^\d{4}$/.test(payload.completion_year)) return json({ error: "Enter a valid completion year." }, 400);

    const { data: applicationId, error } = await svc.rpc("submit_orientation_application", {
      p_student_id: user.id, p_email: user.email, p_payload: payload,
    });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, application_id: applicationId });
  } catch (error) {
    return json({ error: String(error?.message ?? error) }, 500);
  }
});
