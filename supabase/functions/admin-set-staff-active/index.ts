// NIPS Portal — safely activate/deactivate a staff account without deleting it.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { ...CORS, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);
  try {
    const svc = createClient(Deno.env.get("SUPABASE_URL")!, Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    const { data: { user: caller } } = await svc.auth.getUser(token);
    if (!caller) return json({ error: "Invalid session" }, 401);
    const { data: admin } = await svc.from("profiles").select("role,is_active").eq("id", caller.id).single();
    if (admin?.role !== "admin" || admin?.is_active === false) return json({ error: "Forbidden" }, 403);

    const { user_id, active } = await req.json();
    if (!user_id || typeof active !== "boolean") return json({ error: "user_id and active are required" }, 400);
    if (user_id === caller.id) return json({ error: "You cannot deactivate your own account" }, 400);
    const { data: target } = await svc.from("profiles").select("role").eq("id", user_id).single();
    if (!target || target.role === "student") return json({ error: "Only staff accounts can be changed here" }, 400);

    const { error: authError } = await svc.auth.admin.updateUserById(user_id, { ban_duration: active ? "none" : "876000h" });
    if (authError) return json({ error: authError.message }, 400);
    const { error: profileError } = await svc.from("profiles").update({ is_active: active }).eq("id", user_id);
    if (profileError) {
      await svc.auth.admin.updateUserById(user_id, { ban_duration: active ? "876000h" : "none" });
      return json({ error: profileError.message }, 400);
    }
    return json({ ok: true, active });
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
