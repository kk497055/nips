// NIPS Portal — Supabase client config
// NOTE: only the PUBLISHABLE (anon) key belongs here. Never put the secret key in frontend code.
const SUPABASE_URL = "https://qajupsfbmbmbrjlqpstx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Register the PWA service worker (makes the portal installable, offline-tolerant).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/portal/sw.js").catch(() => {}));
}

// Escape any DB/user-controlled string before inserting into innerHTML (prevents stored XSS).
function esc(s) {
  return String(s == null ? "" : s).replace(/[&<>"']/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

// Only allow safe http(s) links; anything else (javascript:, data:) becomes inert.
function safeUrl(u) {
  const s = String(u || "").trim();
  return /^https?:\/\//i.test(s) ? s : "#";
}

// Redirect to login if not authenticated. Returns the session.
async function requireAuth() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { window.location.href = "login.html"; return null; }
  return session;
}

// Fetch the current user's profile (id, full_name, role).
async function getProfile() {
  const { data: { user } } = await sb.auth.getUser();
  if (!user) return null;
  const { data } = await sb.from("profiles").select("*").eq("id", user.id).single();
  return data;
}

// Send the user to the dashboard that matches their role.
function routeByRole(role) {
  if (role === "admin") window.location.href = "admin.html";
  else if (role === "teacher") window.location.href = "teacher.html";
  else window.location.href = "student.html";
}

async function logout() {
  await sb.auth.signOut();
  window.location.href = "login.html";
}

// ---------- Batch Q&A / discussion (shared by teacher + student) ----------
async function openQA(batchId, batchName) {
  const { data: { user } } = await sb.auth.getUser();
  window._qa = { batchId, uid: user.id };
  let modal = document.getElementById("qa-modal");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "qa-modal";
    modal.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:60;align-items:center;justify-content:center;padding:16px";
    modal.innerHTML = `<div class="card" style="width:100%;max-width:600px;max-height:88vh;overflow:auto">
      <h3 id="qa-title">Q&amp;A</h3>
      <div id="qa-compose"></div>
      <div id="qa-list"></div>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn" style="background:#e5e7eb" onclick="document.getElementById('qa-modal').style.display='none'">Close</button>
      </div></div>`;
    document.body.appendChild(modal);
  }
  document.getElementById("qa-title").textContent = "Q&A — " + (batchName || "");
  modal.style.display = "flex";
  await renderQA();
}

async function renderQA() {
  const { batchId } = window._qa;
  const { data: posts } = await sb.from("posts").select("*").eq("batch_id", batchId).order("created_at", { ascending: true });
  const tops = (posts || []).filter(p => !p.parent_id);
  const repliesOf = id => (posts || []).filter(p => p.parent_id === id);
  document.getElementById("qa-compose").innerHTML =
    `<div class="field"><textarea id="qa-new" rows="2" placeholder="Ask a question…"></textarea></div>
     <div class="row-actions" style="margin-bottom:12px"><button class="btn green sm" onclick="postQA()">Post question</button></div>`;
  document.getElementById("qa-list").innerHTML = tops.length ? tops.map(p => `
    <div class="card" style="margin-bottom:10px">
      <div><strong>${esc(p.author_name || 'User')}</strong> <span class="meta">${new Date(p.created_at).toLocaleString()}</span></div>
      <div style="margin:6px 0;white-space:pre-wrap">${esc(p.body)}</div>
      ${repliesOf(p.id).map(r => `<div style="border-left:2px solid var(--border);padding-left:10px;margin:6px 0">
        <strong>${esc(r.author_name || 'User')}</strong> <span class="meta">${new Date(r.created_at).toLocaleString()}</span>
        <div style="white-space:pre-wrap">${esc(r.body)}</div></div>`).join("")}
      <div style="display:flex;gap:6px;margin-top:6px">
        <input id="qr-${p.id}" placeholder="Reply…" style="flex:1;padding:8px;border:1px solid var(--border);border-radius:8px"/>
        <button class="btn sm" onclick="replyQA('${p.id}')">Reply</button></div>
    </div>`).join("") : '<p class="empty">No questions yet. Be the first to ask!</p>';
}

async function postQA() {
  const body = document.getElementById("qa-new").value.trim();
  if (!body) return;
  const { error } = await sb.from("posts").insert({ batch_id: window._qa.batchId, body });
  if (error) return alert("Error: " + error.message);
  await renderQA();
}

async function replyQA(parentId) {
  const el = document.getElementById("qr-" + parentId);
  const body = el.value.trim();
  if (!body) return;
  const { error } = await sb.from("posts").insert({ batch_id: window._qa.batchId, body, parent_id: parentId });
  if (error) return alert("Error: " + error.message);
  await renderQA();
}
