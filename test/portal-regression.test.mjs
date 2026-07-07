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

test("curriculum templates are reusable teacher-owned content", () => {
  const schema = read("portal/db-schema.sql");
  const patch = read("portal/curriculum-templates.sql");

  for (const source of [schema, patch]) {
    assert.match(source, /create table if not exists public\.curriculum_templates/i);
    assert.match(source, /create table if not exists public\.curriculum_template_topics/i);
    assert.match(source, /owner_id\s+uuid not null references public\.profiles\(id\)/i);
    assert.match(source, /create or replace function public\.is_teacher\(\)/i);
    assert.match(source, /role in \('teacher','admin'\)/i);
    assert.match(source, /create or replace function public\.owns_curriculum_template/i);
    assert.match(source, /owner_id = auth\.uid\(\) or public\.is_admin\(\)/i);
  }
});

test("teacher UX separates designing curriculum from applying it to a batch", () => {
  const teacher = read("portal/teacher.html");

  assert.match(teacher, /Teacher Console/);
  assert.match(teacher, /My Curriculum/);
  assert.match(teacher, /Create Curriculum/);
  assert.match(teacher, /Batch Syllabus/);
  assert.match(teacher, /Syllabus Progress/);
  assert.match(teacher, /Apply Curriculum to Batch/);
  assert.match(teacher, /from\("curriculum_templates"\)\.insert/);
  assert.match(teacher, /from\("curriculum_template_topics"\)\.insert/);
  assert.match(teacher, /function applyTemplateToBatch\(\)/);
  assert.match(teacher, /from\("curriculum_topics"\)\.insert\(rows\)/);
  assert.match(teacher, /from\("curriculum_topics"\)\.delete\(\)\.eq\("batch_id", curBatch\)/);
});

test("student syllabus remains batch progress, not reusable template content", () => {
  const student = read("portal/student.html");

  assert.match(student, /from\("curriculum_topics"\)[\s\S]*\.eq\("batch_id", b\.id\)/);
  assert.doesNotMatch(student, /curriculum_templates/);
  assert.doesNotMatch(student, /curriculum_template_topics/);
});

test("admin-created accounts can include admin role from the UI and edge function", () => {
  const admin = read("portal/admin.html");
  const createUser = read("supabase/functions/admin-create-user/index.ts");

  assert.match(admin, /<option value="admin">Admin<\/option>/);
  assert.match(createUser, /me\?\.role !== "admin"/);
  assert.match(createUser, /role === "admin" \? "admin"/);
});

test("admin business overview defaults to bounded date-range activity", () => {
  const admin = read("portal/admin.html");

  assert.match(admin, /<select id="ov-range">/);
  assert.match(admin, /<option value="30d">Last 30 days<\/option>/);
  assert.match(admin, /<option value="custom">Custom<\/option>/);
  assert.match(admin, /<option value="all">All time<\/option>/);
  assert.match(admin, /function initOverviewControls\(\)/);
  assert.match(admin, /function overviewRange\(\)/);
  assert.match(admin, /function inRange\(q, col, range/);
  assert.match(admin, /from\("payments"\)\.select\("batch_id,amount,paid_on"\)/);
  assert.match(admin, /from\("sessions"\)\.select\("batch_id,started_at,ended_at,recording_url,created_by"\)/);
  assert.match(admin, /from\("attendance"\)\.select\("status,session_date"\)/);
  assert.doesNotMatch(admin, /from\("attendance"\)\.select\("status"\)/);
});
