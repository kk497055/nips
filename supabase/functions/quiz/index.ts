// NIPS Portal — quiz take/grade
// Students never receive correct answers. This function serves sanitized
// questions and grades submissions server-side, then records the attempt.

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
    const { data: me } = await svc.from("profiles").select("role,full_name").eq("id", user.id).single();
    const role = me?.role ?? "student";

    const { action, quiz_id, answers } = await req.json();
    if (!quiz_id) return json({ error: "quiz_id required" }, 400);

    const { data: quiz } = await svc.from("quizzes").select("id,title,batch_id").eq("id", quiz_id).single();
    if (!quiz) return json({ error: "Quiz not found" }, 404);
    const { data: batch } = await svc.from("batches").select("teacher_id").eq("id", quiz.batch_id).single();

    // Access: admin, the batch teacher, or a paid/demo enrolled student.
    let allowed = role === "admin" || batch?.teacher_id === user.id;
    if (!allowed) {
      const { data: enr } = await svc.from("enrollments").select("payment_status")
        .eq("batch_id", quiz.batch_id).eq("student_id", user.id).maybeSingle();
      allowed = !!enr && (enr.payment_status === "paid" || enr.payment_status === "demo");
    }
    if (!allowed) return json({ error: "No access to this quiz" }, 403);

    const { data: questions } = await svc.from("quiz_questions")
      .select("id,prompt,options,correct_index,position").eq("quiz_id", quiz_id).order("position");

    if (action === "take") {
      const { data: prior } = await svc.from("quiz_attempts")
        .select("score,total").eq("quiz_id", quiz_id).eq("student_id", user.id).maybeSingle();
      // Strip correct answers before sending to the client.
      const safe = (questions ?? []).map((q) => ({ id: q.id, prompt: q.prompt, options: q.options }));
      return json({ title: quiz.title, questions: safe, prior });
    }

    if (action === "submit") {
      if (!questions || !questions.length) return json({ error: "Quiz has no questions" }, 400);
      let score = 0;
      const correct: Record<string, number> = {};
      for (const q of questions) {
        correct[q.id] = q.correct_index;
        if (answers && Number(answers[q.id]) === q.correct_index) score++;
      }
      const total = questions.length;
      await svc.from("quiz_attempts").upsert({
        quiz_id, batch_id: quiz.batch_id, student_id: user.id,
        student_name: me?.full_name ?? "Student", score, total, submitted_at: new Date().toISOString(),
      }, { onConflict: "quiz_id,student_id" });
      return json({ score, total, correct });
    }

    return json({ error: "Unknown action" }, 400);
  } catch (e) {
    return json({ error: String(e?.message ?? e) }, 500);
  }
});
