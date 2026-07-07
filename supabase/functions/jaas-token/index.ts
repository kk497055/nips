// NIPS Portal — JaaS (8x8) token minter
// Authenticates the caller, confirms their access to the batch, and signs a
// short-lived JaaS JWT: teacher/admin => moderator, paid student => guest.
// Secrets (JAAS_APP_ID, JAAS_KID, JAAS_PRIVATE_KEY) live in Supabase, never the browser.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";
import { SignJWT, importPKCS8 } from "https://esm.sh/jose@5";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "GET, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

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
    const APP_ID = Deno.env.get("JAAS_APP_ID")!;
    const KID = Deno.env.get("JAAS_KID")!;
    const PRIVATE_KEY = Deno.env.get("JAAS_PRIVATE_KEY")!;
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    // 1. Identify the caller from their Supabase access token.
    const authHeader = req.headers.get("Authorization") ?? "";
    const token = authHeader.replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
    const { data: { user }, error: userErr } = await svc.auth.getUser(token);
    if (userErr || !user) return json({ error: "Invalid session" }, 401);

    // 2. Look up the batch requested.
    const url = new URL(req.url);
    const batchId = url.searchParams.get("batch");
    if (!batchId) return json({ error: "Missing batch" }, 400);

    const { data: batch } = await svc.from("batches").select("id,name,jitsi_room,teacher_id").eq("id", batchId).single();
    if (!batch) return json({ error: "Batch not found" }, 404);

    const { data: profile } = await svc.from("profiles").select("full_name,role").eq("id", user.id).single();
    const role = profile?.role ?? "student";

    // 3. Decide access + moderator status (mirrors the portal's RLS).
    let moderator = false;
    if (role === "admin" || await teachesBatch(svc, batchId, user.id)) {
      moderator = true;
    } else {
      const { data: enr } = await svc.from("enrollments")
        .select("payment_status").eq("batch_id", batchId).eq("student_id", user.id).maybeSingle();
      if (!enr || enr.payment_status !== "paid") return json({ error: "No access to this class" }, 403);
    }

    // 4. Sign the JaaS JWT.
    const now = Math.floor(Date.now() / 1000);
    const key = await importPKCS8(PRIVATE_KEY, "RS256");
    const jwt = await new SignJWT({
      aud: "jitsi",
      iss: "chat",
      sub: APP_ID,
      room: batch.jitsi_room,
      context: {
        user: {
          id: user.id,
          name: profile?.full_name ?? "NIPS User",
          moderator: moderator ? "true" : "false",
        },
        features: {
          recording: moderator ? "true" : "false",
          livestreaming: "false",
          transcription: "false",
          "outbound-call": "false",
        },
      },
    })
      .setProtectedHeader({ alg: "RS256", kid: KID, typ: "JWT" })
      .setIssuedAt(now)
      .setNotBefore(now - 10)
      .setExpirationTime(now + 60 * 60 * 3) // 3 hours
      .sign(key);

    return json({ jwt, appId: APP_ID, room: batch.jitsi_room, moderator, name: profile?.full_name });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
