import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

function inlineScripts(html) {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/gi)]
    .map((match) => match[1].trim())
    .filter(Boolean);
}

test("portal inline scripts parse", () => {
  for (const file of [
    "portal/admin.html",
    "portal/teacher.html",
    "portal/student.html",
    "portal/login.html",
    "portal/classroom.html",
  ]) {
    for (const script of inlineScripts(read(file))) {
      assert.doesNotThrow(() => new Function(script), `${file} has a parse error`);
    }
  }
});

test("co-teacher schema is additive and powers teaches_batch", () => {
  const schema = read("portal/db-schema.sql");
  const patch = read("portal/batch-teachers.sql");

  assert.match(schema, /create table if not exists public\.batch_teachers/i);
  assert.match(schema, /unique \(batch_id, teacher_id\)/i);
  assert.match(schema, /references public\.batches\(id\) on delete cascade/i);
  assert.match(schema, /references public\.profiles\(id\) on delete cascade/i);
  assert.match(schema, /exists\(select 1 from public\.batches where id = b and teacher_id = auth\.uid\(\)\)/i);
  assert.match(schema, /exists\(select 1 from public\.batch_teachers where batch_id = b and teacher_id = auth\.uid\(\)\)/i);
  assert.match(patch, /create table if not exists public\.batch_teachers/i);
});

test("teacher and admin UX support co-teachers without removing primary teacher", () => {
  const teacher = read("portal/teacher.html");
  const admin = read("portal/admin.html");

  assert.doesNotMatch(teacher, /\.eq\("teacher_id"/, "teacher dashboard must rely on RLS, not only primary teacher_id");
  assert.match(admin, /Assign Primary/);
  assert.match(admin, /Add Co-teacher/);
  assert.match(admin, /Remove Co-teacher/);
  assert.match(admin, /Co-teachers:/);
  assert.match(admin, /batches"\)\.update\(\{ teacher_id:/, "primary teacher assignment remains backward-compatible");
});

test("edge functions recognize batch_teachers for privileged teacher actions", () => {
  for (const file of [
    "supabase/functions/jaas-token/index.ts",
    "supabase/functions/notify/index.ts",
    "supabase/functions/quiz/index.ts",
  ]) {
    const source = read(file);
    assert.match(source, /from\("batch_teachers"\)/, `${file} must check co-teacher access`);
    assert.match(source, /async function teachesBatch/, `${file} should centralize teacher access`);
  }
});

test("quiz take action still strips correct answers", () => {
  const quiz = read("supabase/functions/quiz/index.ts");

  assert.match(quiz, /const safe = \(questions \?\? \[\]\)\.map/);
  assert.match(quiz, /prompt: q\.prompt, options: q\.options/);
  assert.doesNotMatch(
    quiz.match(/if \(action === "take"\) \{[\s\S]*?\n    \}/)?.[0] ?? "",
    /correct_index/,
    "student quiz payload must not include correct_index"
  );
});
