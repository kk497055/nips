// NIPS Portal — admin-create-user
// Admin-only: creates a PRE-VERIFIED account (skips email confirmation) and sets
// the role. Uses the service key server-side; the caller must be an admin.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (b: unknown, s = 200) =>
  new Response(JSON.stringify(b), { status: s, headers: { ...CORS, "Content-Type": "application/json" } });

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  try {
    const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
    const SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);
    const { data: { user } } = await svc.auth.getUser(token);
    if (!user) return json({ error: "Invalid session" }, 401);
    const { data: me } = await svc.from("profiles").select("role").eq("id", user.id).single();
    if (me?.role !== "admin") return json({ error: "Forbidden" }, 403);

    const { email, password, full_name, role } = await req.json();
    if (!email || !password) return json({ error: "email and password are required" }, 400);
    if (password.length < 6) return json({ error: "password must be at least 6 characters" }, 400);
    const wantRole = role === "teacher" ? "teacher" : role === "admin" ? "admin" : "student";

    // Create the account, already email-confirmed.
    const { data: created, error } = await svc.auth.admin.createUser({
      email, password, email_confirm: true,
      user_metadata: { full_name: full_name || "New User" },
    });
    if (error) return json({ error: error.message }, 400);

    // The signup trigger inserts a 'student' profile; set the requested role + name.
    await svc.from("profiles").update({ full_name: full_name || "New User", role: wantRole }).eq("id", created.user.id);

    return json({ ok: true, user_id: created.user.id, email, role: wantRole });
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
