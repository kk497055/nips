// NIPS Portal — admin-send-password-reset
// Admin-only: sends a secure, time-limited Supabase password-recovery link for
// an existing staff or student account. It never reveals or changes passwords.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { ...CORS, "Content-Type": "application/json" },
});

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const svc = createClient(url, serviceKey, { auth: { persistSession: false } });
    const token = (req.headers.get("Authorization") ?? "").replace("Bearer ", "");
    if (!token) return json({ error: "Not signed in" }, 401);

    const { data: { user: caller } } = await svc.auth.getUser(token);
    if (!caller) return json({ error: "Invalid session" }, 401);
    const { data: profile } = await svc.from("profiles").select("role").eq("id", caller.id).single();
    if (profile?.role !== "admin") return json({ error: "Forbidden" }, 403);

    const { user_id } = await req.json();
    if (!user_id || typeof user_id !== "string") return json({ error: "user_id is required" }, 400);
    if (user_id === caller.id) return json({ error: "Use the sign-in page to reset your own password" }, 400);

    const { data: target, error: targetError } = await svc.auth.admin.getUserById(user_id);
    if (targetError || !target.user?.email) return json({ error: "User account was not found" }, 404);

    const { error } = await svc.auth.resetPasswordForEmail(target.user.email, {
      redirectTo: "https://nips.com.pk/portal/reset-password.html",
    });
    if (error) return json({ error: error.message }, 400);

    return json({ ok: true });
  } catch (error) {
    return json({ error: String(error instanceof Error ? error.message : error) }, 500);
  }
});
