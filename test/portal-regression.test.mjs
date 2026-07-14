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

test("admin can safely edit a batch and add students from its batch card", () => {
  const admin = read("portal/admin.html");

  assert.match(admin, /Edit Batch/);
  assert.match(admin, /openBatchDetails\('\$\{b\.id\}'\)/, "batch title should open its details");
  assert.match(admin, /function openBatchDetails\(batchId\)/);
  assert.match(admin, /Student Roster/);
  assert.match(admin, /function openBatchEditor\(batchId\)/);
  assert.match(admin, /from\("batches"\)\.update\(\{/);
  assert.match(admin, /Students<\/button>/);
  assert.match(admin, /function openBatchStudents\(batchId\)/);
  assert.match(admin, /Add Selected Students/);
  assert.match(admin, /Agreed fee per student/);
  assert.match(admin, /Discount reason/);
  assert.match(admin, /amount < standardFee && !discountNote/);
  assert.match(admin, /discount_note: amount < standardFee \? discountNote : null/);
  assert.match(admin, /function openEnrollmentFee\(studentId\)/);
  assert.match(admin, /Edit fee/);
  assert.match(admin, /const paymentNote = \(batchName, discountNote\)/);
  assert.match(admin, /from\("enrollments"\)\.upsert\(/);
  assert.match(admin, /selected\.map\(studentId => recordPayment\(studentId, managingBatchId\)\)/);
  assert.doesNotMatch(admin, /from\("batches"\)\.delete\(/, "batch management must not delete live batches");
  assert.doesNotMatch(admin, /from\("enrollments"\)\.delete\(/, "student management must not remove enrollments");
});

test("discount schema patch is additive", () => {
  const patch = read("portal/enrollment-discounts.sql");
  assert.match(patch, /alter table public\.enrollments/i);
  assert.match(patch, /add column if not exists discount_note text/i);
  assert.doesNotMatch(patch, /drop |delete |truncate /i);
});

test("admin payment ledger and receipt flow are present", () => {
  const admin = read("portal/admin.html");
  const notify = read("supabase/functions/notify/index.ts");
  const payments = read("portal/payment-receipts.sql");

  assert.match(admin, /Payment Ledger/);
  assert.match(admin, /function loadPaymentLedger\(\)/);
  assert.match(admin, /function sendPaymentReceipt\(paymentId\)/);
  assert.match(admin, /await sendPaymentReceipt\(payment\.id\)/);
  assert.match(notify, /payment_receipt/);
  assert.match(notify, /receiptPdf/);
  assert.match(notify, /kashif@nips\.com\.pk/);
  assert.match(notify, /attachments:/);
  assert.match(payments, /add column if not exists receipt_number text/i);
  assert.match(payments, /add column if not exists receipt_sent_at timestamptz/i);
  assert.doesNotMatch(payments, /drop |delete |truncate /i);
});

test("monthly billing is additive and limits delinquency to live-class access", () => {
  const schema = read("portal/monthly-billing.sql");
  const admin = read("portal/admin.html");
  const dunning = read("supabase/functions/monthly-dunning/index.ts");
  const jaas = read("supabase/functions/jaas-token/index.ts");

  assert.match(schema, /add column if not exists monthly_billing_enabled boolean/i);
  assert.match(schema, /create table if not exists public\.monthly_invoices/i);
  assert.match(schema, /unique \(batch_id, student_id, billing_month\)/i);
  assert.match(schema, /status in \('pending','grace','delinquent','paid'\)/i);
  assert.doesNotMatch(schema, /drop table|delete from|truncate /i);
  assert.match(admin, /Monthly billing/);
  assert.match(admin, /Monthly Due Payments/);
  assert.match(admin, /function grantMonthlyGrace\(invoiceId\)/);
  assert.match(admin, /function markMonthlyInvoicePaid\(invoiceId\)/);
  assert.match(dunning, /GRACE_DAYS = 7/);
  assert.match(dunning, /pending -> grace -> delinquent/);
  assert.match(dunning, /BILLING_SCHEDULE_SECRET/);
  assert.match(jaas, /monthly_billing_enabled/);
  assert.match(jaas, /status", "delinquent"/);
  assert.match(jaas, /live-class access is paused/i);
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

test("people table can promote users to admin with self-change guard", () => {
  const admin = read("portal/admin.html");

  assert.match(admin, /Make Admin/);
  assert.match(admin, /setRole\('\$\{u\.id\}','admin'\)/);
  assert.match(admin, /id === window\._meId/);
  assert.match(admin, /You cannot change your own role/);
  assert.match(admin, /role === "admin" && !confirm/);
});

test("admin business overview defaults to bounded date-range activity", () => {
  const admin = read("portal/admin.html");
  const css = read("portal/portal.css");

  assert.match(admin, /<input type="hidden" id="ov-range" value="30d"\/>/);
  assert.match(admin, /data-range="30d">30 days<\/button>/);
  assert.match(admin, /data-range="custom">Custom<\/button>/);
  assert.match(admin, /data-range="all">All time<\/button>/);
  assert.match(admin, /id="ov-custom"/);
  assert.match(admin, /function initOverviewControls\(\)/);
  assert.match(admin, /function overviewRange\(\)/);
  assert.match(admin, /function inRange\(q, col, range/);
  assert.match(admin, /from\("payments"\)\.select\("batch_id,amount,paid_on"\)/);
  assert.match(admin, /from\("sessions"\)\.select\("batch_id,started_at,ended_at,recording_url,created_by"\)/);
  assert.match(admin, /from\("attendance"\)\.select\("status,session_date"\)/);
  assert.doesNotMatch(admin, /from\("attendance"\)\.select\("status"\)/);
  assert.match(css, /\.overview-custom\{[\s\S]*display:none/);
  assert.match(css, /\.overview-custom\.open\{display:grid\}/);
});

test("admin console is organized into focused routed workspaces", () => {
  const admin = read("portal/admin.html");

  for (const view of ["overview", "batches", "students", "billing", "communications", "staff"]) {
    assert.match(admin, new RegExp(`${view}: \\{ label:`));
    assert.match(admin, new RegExp(`data-admin-view=\"[^\"]*${view}`));
  }
  assert.match(admin, /href="admin\.html\?view=\$\{key\}"/);
  assert.match(admin, /function setupAdminWorkspace\(\)/);
  assert.match(admin, /section\.hidden = !section\.dataset\.adminView/);
  assert.match(admin, /view === "billing"/);
  assert.match(admin, /view === "batches"/);
  assert.match(admin, /view === "students"/);
});

test("portal pages use current stylesheet cache key", () => {
  for (const file of [
    "portal/admin.html",
    "portal/teacher.html",
    "portal/student.html",
    "portal/login.html",
    "portal/classroom.html",
  ]) {
    assert.match(read(file), /portal\.css\?v=9/, `${file} should request the latest portal.css`);
    assert.match(read(file), /config\.js\?v=9/, `${file} should request the latest portal behavior`);
  }
});

test("student centre keeps existing dashboard data in focused self-service views", () => {
  const student = read("portal/student.html");
  const config = read("portal/config.js");

  for (const view of ["home", "classes", "learning", "fees", "account"]) {
    assert.match(student, new RegExp(`data-student-nav="${view}"`));
  }
  assert.match(student, /function setupStudentWorkspace\(profile\)/);
  assert.match(student, /data-student-view="fees"/);
  assert.match(student, /My Fees/);
  assert.match(student, /printReceipt/);
  assert.match(student, /Contact NIPS/);
  assert.match(config, /beforeinstallprompt/);
  assert.match(config, /function installPortalApp\(\)/);
  assert.match(config, /function showPortalInstallHelp\(\)/);
  assert.doesNotMatch(student, /wa\.me/);
});

test("public site has a free install entry point for the portal", () => {
  const install = read("portal/install.html");
  const site = read("js/main.js");

  assert.match(install, /Get the NIPS Portal/);
  assert.match(install, /data-pwa-install/);
  assert.match(install, /Install on this device/);
  assert.match(install, /No App Store or Google Play account is required/);
  assert.match(site, /function initPortalFooterLink\(\)/);
  assert.match(site, /href="\/portal\/install\.html"/);
  assert.match(site, /Get the NIPS Portal/);
});

test("signed-in portal pages have a footer and are not indexable", () => {
  const config = read("portal/config.js");
  const headers = read("_headers");
  const protectedPages = ["portal/admin.html", "portal/student.html", "portal/teacher.html", "portal/classroom.html"];

  assert.match(config, /function initPortalFooter\(\)/);
  assert.match(config, /Get the NIPS Portal/);
  assert.match(config, /Privacy Policy/);
  assert.match(config, /Terms of Use/);
  assert.match(config, /© 2026 NIPS Education Solutions/);
  for (const file of protectedPages) {
    assert.match(read(file), /<meta name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(headers, new RegExp(`/${file}\\n  X-Robots-Tag: noindex, nofollow, noarchive`));
  }
  assert.match(read("portal/classroom.html"), /data-portal-footer="false"/);
});
