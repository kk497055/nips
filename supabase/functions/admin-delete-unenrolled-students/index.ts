// NIPS Portal — permanently delete student accounts only when they have no batch memberships.
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
    const token = (req.headers.get("Authorization") || "").replace("Bearer ", "");
    const { data: { user: caller } } = await svc.auth.getUser(token);
    if (!caller) return json({ error: "Invalid session" }, 401);
    const { data: admin } = await svc.from("profiles").select("role,is_active").eq("id", caller.id).single();
    if (admin?.role !== "admin" || admin?.is_active === false) return json({ error: "Forbidden" }, 403);

    const body = await req.json();
    const userIds = [...new Set(Array.isArray(body.user_ids) ? body.user_ids.filter((id: unknown) => typeof id === "string") : [])].slice(0, 100);
    if (!userIds.length) return json({ error: "Select at least one student" }, 400);

    const deleted: string[] = [];
    const failed: Array<{ user_id: string; error: string }> = [];
    for (const userId of userIds) {
      const { data: target } = await svc.from("profiles").select("role,full_name").eq("id", userId).maybeSingle();
      if (!target || target.role !== "student") { failed.push({ user_id: userId, error: "Student account not found" }); continue; }
      const { count, error: countError } = await svc.from("enrollments").select("id", { count: "exact", head: true }).eq("student_id", userId);
      if (countError) { failed.push({ user_id: userId, error: countError.message }); continue; }
      if ((count || 0) > 0) { failed.push({ user_id: userId, error: "Cannot delete a student who belongs to a batch" }); continue; }
      const { error } = await svc.auth.admin.deleteUser(userId);
      if (error) failed.push({ user_id: userId, error: error.message });
      else deleted.push(userId);
    }
    return json({ ok: failed.length === 0, deleted: deleted.length, deleted_ids: deleted, failed });
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
