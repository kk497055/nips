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
  const shared = read("portal/config.js");
  for (const file of [
    "portal/admin.html",
    "portal/teacher.html",
    "portal/student.html",
    "portal/login.html",
    "portal/reset-password.html",
    "portal/classroom.html",
    "portal/orientation.html",
    "portal/admin-batch.html",
    "portal/admin-certificates.html",
    "portal/teacher-apply.html",
  ]) {
    for (const script of inlineScripts(read(file))) {
      assert.doesNotThrow(() => new Function(script), `${file} has a parse error`);
      assert.doesNotThrow(() => new Function(`${shared}\n${script}`), `${file} conflicts with shared portal code`);
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

  assert.match(teacher, /from\("batches"\)\.select\("\*"\)\.eq\("is_active", true\)/, "teacher batch loading must rely on RLS, not only primary teacher_id");
  assert.match(admin, /Assign Primary/);
  assert.match(admin, /Add Co-teacher/);
  assert.match(admin, /Remove Co-teacher/);
  assert.match(admin, /Co-teachers:/);
  assert.match(admin, /batches"\)\.update\(\{ teacher_id:/, "primary teacher assignment remains backward-compatible");
});

test("admin can safely edit a batch and add students from its batch card", () => {
  const admin = read("portal/admin.html");

  assert.match(admin, /Edit Batch/);
  assert.match(admin, /admin-batch\.html\?id=\$\{encodeURIComponent\(b\.id\)\}/, "batch title should open its dedicated details page");
  assert.match(admin, /function openBatchDetails\(batchId\)/);
  assert.match(admin, /Student Roster/);
  assert.match(admin, /function openBatchEditor\(batchId\)/);
  assert.match(admin, /from\("batches"\)\.update\(\{/);
  assert.match(admin, />Students<\/a>/);
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

test("embedded video classes disable participant chat", () => {
  const classroom = read("portal/classroom.html");

  assert.match(classroom, /disableChat:\s*true/);
  assert.doesNotMatch(classroom, /\['microphone','camera'[^\]]*'chat'/);
});

test("admins can atomically move students and safely retire batches", () => {
  const admin = read("portal/admin.html");
  const teacher = read("portal/teacher.html");
  const student = read("portal/student.html");
  const migration = read("supabase/migrations/20260921000000_safe_batch_operations.sql");

  assert.match(admin, /Move \/ retire/);
  assert.match(admin, /retired: \{ label: "Retired Batches"/);
  assert.match(admin, /showingRetired \? !batch\.is_active : batch\.is_active/);
  assert.match(admin, /Restore Batch/);
  assert.match(admin, /data-admin-view="batches retired"/);
  assert.match(admin, /admin_move_batch_students/);
  assert.match(admin, /admin_retire_empty_batch/);
  assert.match(teacher, /from\("batches"\)\.select\("\*"\)\.eq\("is_active", true\)/);
  assert.match(student, /from\("batches"\)\.select\("\*"\)\.eq\("is_active", true\)/);
  assert.match(migration, /if not public\.is_admin\(\)/);
  assert.match(migration, /update public\.enrollments\s+set batch_id = p_target_batch_id/i);
  assert.match(migration, /set is_active = false/);
  assert.doesNotMatch(migration, /delete from public\.batches/i, "retiring a batch must preserve its history");
});

test("batch creation offers the approved academic and arts category hierarchy", () => {
  const admin = read("portal/admin.html");

  for (const category of ["5th", "6th", "7th", "8th", "9th", "10th", "O1", "O2", "O3", "First Year", "Second Year", "A1", "A2", "Painting", "Calligraphy", "Sketching"]) {
    assert.match(admin, new RegExp(`<option>${category}</option>`));
  }
  assert.match(admin, /<optgroup label="Institute of Arts and Culture">/);
  assert.doesNotMatch(admin, /<optgroup label="Other Academic Programs">/);
  assert.equal((admin.match(/<option>Calligraphy<\/option>/g) || []).length, 1, "Calligraphy is listed only under Institute of Arts and Culture");
});

test("orientation students can be enrolled into a selected existing batch", () => {
  const admin = read("portal/admin.html");

  assert.match(admin, /— select existing batch —/);
  assert.match(admin, /Enroll in batch/);
  assert.match(admin, /transitionOrientationStudent\('\$\{a\.student_id\}','orientation-batch-\$\{a\.id\}'\)/);
  assert.match(admin, /courses\.find\(course => course\.id === batchId\)/);
  assert.match(admin, /payment_status: "pending"/);
  assert.match(admin, /if \(existing\) return alert/);
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

test("admins can send a secure reset link without handling another user's password", () => {
  const admin = read("portal/admin.html");
  const reset = read("portal/reset-password.html");
  const fn = read("supabase/functions/admin-send-password-reset/index.ts");
  const headers = read("_headers");

  assert.match(admin, /Send password reset/);
  assert.match(admin, /function sendPasswordReset\(userId, fullName\)/);
  assert.match(admin, /functions\/v1\/admin-send-password-reset/);
  assert.match(admin, /Their password will not change unless they use the link/);
  assert.match(fn, /profile\?\.role !== "admin"/);
  assert.match(fn, /auth\.admin\.getUserById\(user_id\)/);
  assert.match(fn, /auth\.resetPasswordForEmail\(target\.user\.email/);
  assert.match(fn, /redirectTo: "https:\/\/nips\.com\.pk\/portal\/reset-password\.html"/);
  assert.match(fn, /user_id === caller\.id/);
  assert.doesNotMatch(fn, /updateUser\(\{ password/);
  assert.match(reset, /sb\.auth\.updateUser\(\{ password \}\)/);
  assert.match(reset, /PASSWORD_RECOVERY/);
  assert.match(reset, /noindex, nofollow, noarchive/);
  assert.match(headers, /\/portal\/reset-password\.html\n  X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(read("portal/login.html"), /Forgot your password\?/);
  assert.match(read("portal/login.html"), /resetPasswordForEmail\(email/);
});

test("student administration remains readable on desktop and mobile", () => {
  const admin = read("portal/admin.html");
  const css = read("portal/portal.css");

  assert.match(admin, /class="people-table"/);
  assert.match(admin, /data-label="Email" class="breakable"/);
  assert.match(admin, /<details class="action-menu">/);
  assert.match(admin, /class="student-profile-grid"/);
  assert.doesNotMatch(admin, /student-profile-detail-content[\s\S]{0,500}orientation-detail-grid/);
  assert.match(css, /\.student-profile-grid\{[^}]*repeat\(2,minmax\(0,1fr\)\)/);
  assert.match(css, /\.student-profile-grid strong\{[^}]*overflow-wrap:anywhere/);
  assert.match(css, /@media\(max-width:760px\)[\s\S]*\.people-table thead\{display:none\}/);
  assert.match(css, /\.student-profile-grid\{grid-template-columns:1fr/);
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

  for (const view of ["overview", "batches", "retired", "students", "billing", "communications", "staff"]) {
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
    assert.match(read(file), /portal\.css\?v=16/, `${file} should request the latest portal.css`);
    assert.match(read(file), /config\.js\?v=10/, `${file} should request the latest portal behavior`);
  }
});

test("student centre keeps existing dashboard data in focused self-service views", () => {
  const student = read("portal/student.html");
  const config = read("portal/config.js");
  const financePolicy = read("portal/student-finance-access.sql");

  for (const view of ["home", "classes", "learning", "fees", "account"]) {
    assert.match(student, new RegExp(`data-student-nav="${view}"`));
  }
  assert.match(student, /function setupStudentWorkspace\(profile\)/);
  assert.match(student, /data-student-view="fees"/);
  assert.match(student, /Fees &amp; Receipts/);
  assert.match(student, /My Batch Fees/);
  assert.match(student, /Monthly Payments/);
  assert.match(student, /Payment Receipts/);
  assert.match(student, /No payments yet\./);
  assert.match(student, /paidBatchIds/);
  assert.match(student, /printReceipt/);
  assert.match(student, /Contact NIPS/);
  assert.match(config, /beforeinstallprompt/);
  assert.match(config, /function installPortalApp\(\)/);
  assert.match(config, /function showPortalInstallHelp\(\)/);
  assert.doesNotMatch(student, /wa\.me/);
  assert.match(financePolicy, /create policy batches_student_finance/i);
  assert.match(financePolicy, /student_id = auth\.uid\(\)/i);
  assert.doesNotMatch(financePolicy, /drop |delete |truncate /i);
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
  assert.match(read("portal/portal.css"), /body:not\(\.auth\):not\(\[data-portal-footer="false"\]\)\{min-height:100vh/);
  for (const file of protectedPages) {
    assert.match(read(file), /<meta name="robots" content="noindex, nofollow, noarchive"/);
    assert.match(headers, new RegExp(`/${file}\\n  X-Robots-Tag: noindex, nofollow, noarchive`));
  }
  assert.match(read("portal/classroom.html"), /data-portal-footer="false"/);
});

test("IAC orientation registration is isolated, verified, and transition-ready", () => {
  const form = read("portal/orientation.html");
  const schema = read("portal/orientation.sql");
  const admin = read("portal/admin.html");
  const fn = read("supabase/functions/orientation-register/index.ts");
  const cohorts = read("supabase/migrations/20260814000000_orientation_cohorts.sql");
  const autoscale = read("supabase/migrations/20260814010000_orientation_cohort_autoscale.sql");
  const builder = read("supabase/migrations/20260814020000_orientation_campaign_builder.sql");
  const headers = read("_headers");

  assert.match(builder, /where code = 'iac-orientation'/);
  assert.match(form, /name="education_level"/);
  assert.match(form, /name="interests"/);
  assert.match(form, /redirect\.search = new URLSearchParams\(\{ campaign: campaign\.slug, verified: "1" \}\)/);
  assert.match(form, /sb\.auth\.signUp/);
  assert.match(form, /orientation-register/);
  assert.match(form, /get_public_orientation_campaign/);
  assert.match(form, /noindex, nofollow, noarchive/);
  assert.match(headers, /\/portal\/orientation\.html\n  X-Robots-Tag: noindex, nofollow, noarchive/);
  assert.match(schema, /create table if not exists public\.orientation_programs/i);
  assert.match(schema, /create table if not exists public\.orientation_applications/i);
  assert.match(schema, /payment_status, amount, discount_note/i);
  assert.match(schema, /session_state text not null default 'registration_open'/i);
  assert.match(schema, /orientation_programs_student/i);
  assert.match(schema, /'demo', 0, 'Orientation session — no fee'/);
  assert.match(schema, /orientation_program.*iac-orientation/i);
  assert.doesNotMatch(schema, /drop table|delete from|truncate /i);
  assert.match(fn, /svc\.auth\.getUser\(token\)/);
  assert.match(fn, /submit_orientation_application/);
  assert.match(admin, /data-admin-view="orientation"/);
  assert.match(admin, /transitionOrientationStudent/);
  assert.match(admin, /payment_status: "pending"/);
  assert.match(admin, /mountList\("orientation-applications", "orientation-list", visibleApps/);
  assert.match(admin, /pageSize: 10/);
  assert.match(admin, /Search applicants, email, city or interests/);
  assert.match(admin, /function saveOrientationCohort\(cohortId\)/);
  assert.match(admin, /function bulkAssignOrientationCohort\(\)/);
  assert.match(admin, /function autoAssignOrientationCohorts\(\)/);
  assert.match(admin, /function selectOrientationPage\(csvIds, checked\)/);
  assert.match(admin, /Live-class link/);
  assert.match(admin, /Calendar event link/);
  assert.match(read("portal/orientation-workflow.sql"), /add column if not exists session_state/i);
  assert.doesNotMatch(read("portal/orientation-workflow.sql"), /drop |delete |truncate /i);
  assert.match(cohorts, /create table if not exists public\.orientation_cohorts/i);
  assert.match(cohorts, /capacity integer not null default 50/i);
  assert.match(cohorts, /bulk_assign_orientation_cohort/i);
  assert.match(cohorts, /auto_assign_orientation_cohorts/i);
  assert.match(cohorts, /get_my_orientation_cohorts/i);
  assert.match(cohorts, /case when c\.session_state = 'live' then c\.meet_url else null/i);
  assert.match(cohorts, /orientation_cohort_audit/i);
  assert.doesNotMatch(cohorts, /drop table|delete from|truncate /i);
  assert.match(autoscale, /alter column capacity set default 90/i);
  assert.match(autoscale, /where capacity = 50/i);
  assert.match(autoscale, /create_next_orientation_cohort/i);
  assert.match(autoscale, /assign_orientation_application/i);
  assert.match(autoscale, /rebalance_open_orientation_cohorts/i);
  assert.match(autoscale, /pg_advisory_xact_lock/i);
  assert.match(autoscale, /session_state = 'registration_open'/i);
  assert.doesNotMatch(autoscale, /drop table|delete from|truncate /i);
  assert.match(admin, /Open cohorts hold up to \$\{Number\(selectedProgram\?\.default_cohort_capacity \|\| 90\)\} students/);
  assert.match(admin, /Reconcile assignments/);
  assert.match(builder, /create_orientation_campaign/i);
  assert.match(builder, /get_public_orientation_campaign/i);
  assert.match(builder, /form_config jsonb/i);
  assert.match(builder, /custom_answers jsonb/i);
  assert.match(builder, /scheduled_at timestamptz/i);
  assert.match(builder, /update_orientation_cohort_settings_v2/i);
  assert.match(builder, /campaign_status in \('draft','published','closed','archived'\)/i);
  assert.doesNotMatch(builder, /drop table|delete from|truncate /i);
  assert.match(admin, /function openCampaignWizard\(\)/);
  assert.match(admin, /function publishOrientationCampaign\(\)/);
  assert.match(admin, /type="datetime-local"/);
  assert.match(admin, /Copy registration link/);
  assert.match(admin, /function filterOrientationCohort\(code\)/);
  assert.match(admin, /id="orientation-cohort-filter"/);
  assert.match(admin, /Cohort details/);
  assert.match(admin, /mountList\("orientation-applications", "orientation-list", visibleApps/);
  assert.match(admin, /click title for details/);
  assert.match(read("portal/student.html"), /Your orientation is being arranged/);
  assert.match(read("portal/student.html"), /Join Orientation/);
  assert.match(read("portal/student.html"), /get_my_orientation_cohorts/);
  assert.match(read("portal/student.html"), /state === "live"/);
  assert.match(read("portal/teacher.html"), /Open Live Class/);
});

test("orientation announcements provide email and in-portal notifications without duplicates", () => {
  const admin = read("portal/admin.html");
  const student = read("portal/student.html");
  const schema = read("supabase/migrations/20260815000000_orientation_notifications.sql");
  const notify = read("supabase/functions/notify/index.ts");
  const reminders = read("supabase/functions/class-reminders/index.ts");
  const templates = read("supabase/functions/_shared/templates.ts");

  assert.match(admin, /Save &amp; notify \$\{used\} students/);
  assert.match(admin, /type: "orientation_scheduled", cohort_id: cohortId/);
  assert.match(admin, /Choose Schedule announced before notifying students/);
  assert.match(schema, /create table if not exists public\.portal_notifications/i);
  assert.match(schema, /unique \(recipient_id, delivery_key\)/i);
  assert.match(schema, /recipient_id = auth\.uid\(\)/i);
  assert.doesNotMatch(schema, /drop table|delete from|truncate /i);
  assert.match(notify, /orientation_scheduled/);
  assert.match(notify, /orientation_applications/);
  assert.match(notify, /portal_notifications/);
  assert.match(notify, /deliveryKey = `orientation:/);
  assert.match(templates, /orientation_scheduled/);
  assert.match(templates, /orientation_reminder/);
  assert.match(templates, /confirm receipt of this email and your orientation registration by contacting us at 03137840005/);
  assert.match(notify, /ORIENTATION_CONFIRMATION_TEXT/);
  assert.match(reminders, /ORIENTATION_CONFIRMATION_TEXT/);
  assert.match(reminders, /orientationReminderStage/);
  assert.match(reminders, /minutesUntil > 0 && minutesUntil <= 10/);
  assert.match(reminders, /key: "10m", label: "in 10 minutes"/);
  assert.match(reminders, /stage\.key !== "10m" && announcementIsRecent/);
  assert.match(reminders, /\.in\("session_state", \["scheduled", "live"\]\)/);
  assert.match(reminders, /select\("id,code,batch_id,name,scheduled_at,student_message,meet_url"\)/);
  assert.match(reminders, /\(stage\.key === "10m" \|\| stage\.key === "started"\) && meetUrl \? meetUrl : PORTAL_URL/);
  assert.match(reminders, /joinUrl: meetUrl/);
  assert.match(reminders, /immediateCohortCode \? \{ key: "started", label: "now" \}/);
  assert.match(reminders, /orientation_cohort/);
  assert.match(reminders, /failure_count: orientation\.failures\.length/);
  assert.match(reminders, /no valid class link is saved/);
  assert.match(reminders, /`https:\/\/\$\{savedMeetUrl\}`/);
  assert.match(reminders, /meet_url_valid: meetUrlValid/);
  assert.match(reminders, /assigned_students: count \|\| 0/);
  assert.match(reminders, /minutesUntil > 0 && minutesUntil <= 60/);
  assert.match(reminders, /key: `daily:\$\{today\}`/);
  assert.match(reminders, /calendarDaysUntil === 1 \? "tomorrow"/);
  assert.match(reminders, /stage\.key\.startsWith\("daily:"\) && announcedToday/);
  assert.match(reminders, /portal_notifications/);
  assert.match(reminders, /sendOrientationAnnouncementCatchups/);
  assert.match(reminders, /notifications_enabled_for_scheduled_at/);
  assert.match(reminders, /orientation_scheduled/);
  assert.match(reminders, /announcement\.sent_at/);
  assert.match(student, /data-student-nav="notifications"/);
  assert.match(student, /function renderNotifications\(\)/);
  assert.match(student, /function markAllNotificationsRead\(\)/);
});

test("late orientation assignments inherit an explicitly announced schedule", () => {
  const schema = read("supabase/migrations/20260815010000_orientation_notification_catchup.sql");
  const notify = read("supabase/functions/notify/index.ts");
  const reminders = read("supabase/functions/class-reminders/index.ts");

  assert.match(schema, /add column if not exists notifications_enabled_for_scheduled_at timestamptz/i);
  assert.doesNotMatch(schema, /drop table|delete from|truncate /i);
  assert.match(notify, /notifications_enabled_for_scheduled_at: announcedCohort\.scheduled_at/);
  assert.match(reminders, /new Date\(cohort\.scheduled_at\)\.getTime\(\) !== new Date\(cohort\.notifications_enabled_for_scheduled_at\)\.getTime\(\)/);
  assert.match(reminders, /orientation_applications/);
  assert.match(reminders, /deliveryKey = `orientation:\$\{cohort\.id\}:\$\{cohort\.scheduled_at\}:announced`/);
});

test("operational email prefers Google Workspace and retains Resend fallback", () => {
  const templates = read("supabase/functions/_shared/templates.ts");

  assert.match(templates, /GOOGLE_OAUTH_CLIENT_ID/);
  assert.match(templates, /GOOGLE_OAUTH_CLIENT_SECRET/);
  assert.match(templates, /GOOGLE_OAUTH_REFRESH_TOKEN/);
  assert.match(templates, /GOOGLE_FROM_EMAIL/);
  assert.match(templates, /https:\/\/gmail\.googleapis\.com\/gmail\/v1\/users\/me\/messages\/send/);
  assert.match(templates, /https:\/\/oauth2\.googleapis\.com\/token/);
  assert.match(templates, /Gmail delivery failed; using Resend fallback/);
  assert.match(templates, /https:\/\/api\.resend\.com\/emails/);
  assert.match(templates, /NOTIFY_REPLY_TO/);
  assert.match(templates, /Reply-To:/);
  assert.match(templates, /reply_to:/);
  assert.match(templates, /opts\.attachments/);
});

test("orientation study mode is additive, self-service, and duplicate protected", () => {
  const form = read("portal/orientation.html");
  const student = read("portal/student.html");
  const admin = read("portal/admin.html");
  const notify = read("supabase/functions/notify/index.ts");
  const templates = read("supabase/functions/_shared/templates.ts");
  const migration = read("supabase/migrations/20260819000000_orientation_study_mode.sql");
  assert.match(form, /name="study_mode_preference" value="online" required/);
  assert.match(form, /name="study_mode_preference" value="physical" required/);
  assert.match(student, /set_my_orientation_study_mode/);
  assert.match(admin, /admin_set_orientation_study_mode/);
  assert.match(admin, /orientation_study_mode_request/);
  assert.match(notify, /study-mode-request-v1/);
  assert.match(notify, /is\("study_mode_preference", null\)/);
  assert.match(templates, /Choose your preferred study mode/);
  assert.match(migration, /add column if not exists study_mode_preference/);
  assert.match(migration, /Existing applications intentionally remain NULL/);
  assert.doesNotMatch(migration, /delete from public\.orientation_applications/i);
});

test("orientation roster exposes the existing secure password-reset workflow", () => {
  const admin = read("portal/admin.html");
  assert.match(admin, /transitionOrientationStudent\('\$\{a\.student_id\}','orientation-batch-\$\{a\.id\}'\)/);
  assert.match(admin, /sendPasswordReset\('\$\{a\.student_id\}',this\.dataset\.name\)/);
  assert.match(admin, /Send password reset/);
});

test("announced orientation schedules expose saved Meet links only to assigned students", () => {
  const migration = read("supabase/migrations/20260822000000_orientation_meet_access.sql");
  const student = read("portal/student.html");
  assert.match(migration, /session_state in \('scheduled', 'live'\)/);
  assert.match(migration, /where a\.student_id = auth\.uid\(\)/);
  assert.match(student, /const canJoin = \(state === "scheduled" \|\| isLive\)/);
  assert.match(student, /canJoin \? `<a class="btn green"/);
  assert.doesNotMatch(migration, /delete from|truncate |drop table/i);
});

test("orientation reminders run every five minutes and use provider-neutral class URLs", () => {
  const schedule = read("supabase/migrations/20260822010000_orientation_reminder_scheduler.sql");
  const reminders = read("supabase/functions/class-reminders/index.ts");
  const templates = read("supabase/functions/_shared/templates.ts");
  assert.match(schedule, /nips-class-reminders-five-minutes/);
  assert.match(schedule, /'\*\/5 \* \* \* \*'/);
  assert.match(schedule, /functions\/v1\/class-reminders/);
  assert.match(reminders, /meetUrl/);
  assert.match(templates, /Join Class/);
  assert.match(templates, /orientation_thank_you/);
  assert.match(templates, /separate online joining link/);
  assert.doesNotMatch(schedule, /service_role/i);
  assert.doesNotMatch(schedule, /delete from|truncate |drop table/i);
});

test("external live classes preserve existing classrooms and safely provision the IAC online batch", () => {
  const migration = read("supabase/migrations/20260828000000_provider_neutral_live_classes.sql");
  const admin = read("portal/admin.html");
  const student = read("portal/student.html");
  const teacher = read("portal/teacher.html");
  const reminders = read("supabase/functions/class-reminders/index.ts");
  assert.match(migration, /add column if not exists live_class_url/);
  assert.match(migration, /Warda Mubashir/i);
  assert.match(migration, /Sat · 19:00 \(from 2026-08-29\)/);
  assert.match(migration, /study_mode_preference = 'online'/);
  assert.match(migration, /c\.code in \('cohort-a', 'cohort-b'\)/);
  assert.match(migration, /on conflict \(batch_id, student_id\) do nothing/);
  assert.match(migration, /'demo', 0/);
  assert.doesNotMatch(migration, /delete from|truncate |drop table/i);
  assert.match(admin, /External live-class link/);
  assert.match(student, /b\.live_class_url \? safeUrl\(b\.live_class_url\)/);
  assert.match(teacher, /b\.live_class_url \? safeUrl\(b\.live_class_url\)/);
  assert.match(reminders, /select\("id,name,schedule,live_class_url"\)/);
  assert.match(reminders, /\.in\("payment_status", \["paid", "demo"\]\)/);
});

test("IAC expansion adds all Cohort A and B students without changing prior records", () => {
  const migration = read("supabase/migrations/20260828010000_expand_iac_online_batch.sql");
  assert.match(migration, /c\.code in \('cohort-a', 'cohort-b'\)/);
  assert.doesNotMatch(migration, /study_mode_preference/);
  assert.match(migration, /on conflict \(batch_id, student_id\) do nothing/);
  assert.match(migration, /'demo', 0/);
  assert.match(migration, /on conflict \(recipient_id, delivery_key\) do nothing/);
  assert.doesNotMatch(migration, /delete from|truncate |drop table|update public\.orientation/i);
});

test("student profiles and subject-based batch matching are additive and pending-only", () => {
  const migration = read("supabase/migrations/20260913000000_student_profiles_and_batch_matching.sql");
  const student = read("portal/student.html");
  const admin = read("portal/admin.html");
  assert.match(migration, /add column if not exists subjects text\[\]/);
  assert.match(migration, /add column if not exists preferred_study_modes text\[\]/);
  assert.match(migration, /add column if not exists student_code text/);
  assert.match(migration, /'NIPS' \|\| v_grade \|\| v_subject \|\| v_period/);
  assert.match(migration, /save_my_student_profile/);
  assert.match(migration, /auto_enroll_students_for_batch/);
  assert.match(migration, /'pending'/);
  assert.doesNotMatch(migration, /delete from|truncate |drop table/i);
  assert.match(student, /Complete your profile/);
  assert.match(student, /name="sp-subject"/);
  assert.match(student, /name="sp-mode"/);
  assert.match(student, /name="sp-time"/);
  assert.match(admin, /id="b-subject"/);
  assert.match(admin, /id="b-period"/);
  assert.match(admin, /Filter by subject/);
  assert.match(admin, /openStudentProfileDetail/);
  assert.match(admin, /profile_submitted_at/);
});

test("mobile public navigation keeps the portal entry visible", () => {
  const css = read("css/style.css");
  for (const page of ["index.html", "about.html", "contact.html", "resources.html"]) {
    const html = read(page);
    assert.match(html, /href="\/portal\/login\.html" class="btn btn-outline portal-btn"/);
    assert.match(html, /css\/style\.css\?v=5/);
  }
  assert.match(css, /\.nav-actions \.portal-btn\s*\{[\s\S]*?display:\s*inline-flex/);
});

test("admin membership and access controls preserve records", () => {
  const migration = read("supabase/migrations/20260924000000_admin_membership_and_account_controls.sql");
  const admin = read("portal/admin.html");
  const accessFn = read("supabase/functions/admin-set-staff-active/index.ts");
  assert.match(migration, /add column if not exists is_active boolean not null default true/);
  assert.match(migration, /admin_remove_student_from_batch/);
  assert.match(migration, /delete from public\.enrollments/);
  assert.doesNotMatch(migration, /delete from public\.profiles|delete from auth\.users|truncate |drop table/i);
  assert.match(admin, /removeStudentFromBatch/);
  assert.match(admin, /admin_save_student_profile/);
  assert.match(admin, /setStaffActive/);
  assert.match(accessFn, /ban_duration: active \? "none" : "876000h"/);
  assert.doesNotMatch(accessFn, /deleteUser/);
});

test("batch students use a dedicated searchable paginated admin page", () => {
  const admin = read("portal/admin.html");
  const page = read("portal/admin-batch.html");
  assert.match(admin, /admin-batch\.html\?id=\$\{encodeURIComponent\(b\.id\)\}/);
  assert.doesNotMatch(admin, /onclick="openBatchStudents\('\$\{b\.id\}'\)"/);
  assert.match(page, /mountList\("batch-roster"/);
  assert.match(page, /pageSize:\s*15/);
  assert.match(page, /admin_remove_student_from_batch/);
  assert.match(page, /Edit fee/);
  assert.match(page, /data-student-select/);
  assert.match(page, /profile_submitted_at/);
});

test("completion certificates are recorded, downloadable and publicly verifiable", () => {
  const migration = read("supabase/migrations/20260924010000_certificates_and_teacher_profiles.sql");
  const admin = read("portal/admin-certificates.html");
  const student = read("portal/student.html");
  const pdf = read("supabase/functions/certificate-pdf/index.ts");
  const verify = read("verify-certificate.html");
  assert.match(migration, /create table if not exists public\.certificates/);
  assert.match(migration, /verification_code text not null unique/);
  assert.match(migration, /create or replace function public\.verify_certificate/);
  assert.match(migration, /certificate-assets/);
  assert.doesNotMatch(migration, /delete from|truncate |drop table/i);
  assert.match(admin, /issue_certificate/);
  assert.match(admin, /Issued certificate ledger/);
  assert.match(student, /My Certificates/);
  assert.match(pdf, /QRCode\.toDataURL/);
  assert.match(pdf, /CERTIFICATE OF COMPLETION/);
  assert.match(verify, /verify_certificate/);
});

test("teacher profiles remain private and support staff allocation and appointment letters", () => {
  const migration = read("supabase/migrations/20260924010000_certificates_and_teacher_profiles.sql");
  const teacher = read("portal/teacher.html");
  const admin = read("portal/admin.html");
  const appointment = read("supabase/functions/send-teacher-appointment/index.ts");
  assert.match(migration, /create table if not exists public\.teacher_profiles/);
  assert.match(migration, /teacher_profiles_self/);
  assert.match(migration, /teacher_profiles_admin/);
  assert.match(teacher, /My Professional Profile/);
  assert.doesNotMatch(teacher, /tp-comp-amount|tp-joining|tp-bank|tp-iban/, "teacher self-service must not expose employment or payment fields");
  assert.match(admin, /compensation_amount/, "employment and payment fields remain available to administrators");
  assert.match(admin, /Assign to batch/);
  assert.match(admin, /Send appointment letter/);
  assert.match(admin, /Edit teacher profile/);
  assert.match(appointment, /Appointment confirmation/);
});

test("faculty applications are gated, reviewable and send lifecycle emails", () => {
  const login = read("portal/login.html");
  const apply = read("portal/teacher-apply.html");
  const admin = read("portal/admin.html");
  const migration = read("supabase/migrations/20260924020000_teacher_applications.sql");
  const submit = read("supabase/functions/teacher-application/index.ts");
  const review = read("supabase/functions/admin-teacher-application/index.ts");
  assert.match(login, /Apply as faculty/);
  assert.match(apply, /does not create teacher access/);
  assert.match(migration, /create table if not exists public\.teacher_applications/);
  assert.match(migration, /revoke all on table public\.teacher_applications from anon/);
  assert.match(admin, /Faculty Applications/);
  assert.match(admin, /Approve as teacher/);
  assert.match(submit, /Faculty application received/);
  assert.match(review, /Faculty application approved/);
  assert.match(review, /generateLink\(\{type:"recovery"/);
});

test("certificates snapshot father name and use the verified CEO signature asset", () => {
  const migration = read("supabase/migrations/20260924020000_teacher_applications.sql");
  const admin = read("portal/admin-certificates.html");
  const pdf = read("supabase/functions/certificate-pdf/index.ts");
  const verify = read("verify-certificate.html");
  assert.match(migration, /add column if not exists father_name/);
  assert.match(migration, /ceo-signature-transparent\.png/);
  assert.match(admin, /Father \/ guardian name/);
  assert.match(pdf, /Son \/ daughter of/);
  assert.match(verify, /Father \/ guardian/);
});
