// NIPS Portal — Supabase client config
// NOTE: only the PUBLISHABLE (anon) key belongs here. Never put the secret key in frontend code.
const SUPABASE_URL = "https://qajupsfbmbmbrjlqpstx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

// Register the PWA service worker (makes the portal installable, offline-tolerant).
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => navigator.serviceWorker.register("/portal/sw.js").catch(() => {}));
}

// App-store-free installation: supported browsers provide this prompt; iPhone/iPad
// users get clear, native browser instructions instead. No third-party service is used.
let deferredInstallPrompt = null;
function updateInstallButtons() {
  document.querySelectorAll("[data-pwa-install]").forEach((button) => {
    button.hidden = !deferredInstallPrompt;
  });
}
window.addEventListener("beforeinstallprompt", (event) => {
  event.preventDefault();
  deferredInstallPrompt = event;
  updateInstallButtons();
});
window.addEventListener("appinstalled", () => {
  deferredInstallPrompt = null;
  updateInstallButtons();
});
async function installPortalApp() {
  if (!deferredInstallPrompt) return showPortalInstallHelp();
  deferredInstallPrompt.prompt();
  await deferredInstallPrompt.userChoice;
  deferredInstallPrompt = null;
  updateInstallButtons();
}
function showPortalInstallHelp() {
  let modal = document.getElementById("portal-install-help");
  if (!modal) {
    modal = document.createElement("div");
    modal.id = "portal-install-help";
    modal.className = "portal-modal";
    modal.innerHTML = `<div class="card portal-modal-card" role="dialog" aria-modal="true" aria-labelledby="portal-install-title">
      <h3 id="portal-install-title">Install NIPS Portal</h3>
      <p class="meta">No App Store or Play Store account is needed. Installation is free and keeps the portal one tap away on your device.</p>
      <div class="install-steps">
        <p><strong>Android / Chrome:</strong> open the browser menu (⋮), then choose <em>Install app</em> or <em>Add to Home screen</em>.</p>
        <p><strong>iPhone / iPad:</strong> open this portal in Safari, tap <em>Share</em>, then <em>Add to Home Screen</em>.</p>
        <p><strong>Computer:</strong> use the install icon in the browser address bar when it appears.</p>
      </div>
      <div class="row-actions"><button class="btn green" onclick="document.getElementById('portal-install-help').style.display='none'">Done</button></div>
    </div>`;
    document.body.appendChild(modal);
  }
  modal.style.display = "flex";
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

// Reusable client-side search + pagination for a list container. Pager is always shown.
// opts: { placeholder, noun, empty, pageSize, hideSearch, match(item,term), render(pageItems) }
function mountList(key, containerId, items, opts) {
  const st = (window._lists ||= {})[key] ||= { term: "", page: 1 };
  const box = document.getElementById(containerId);
  if (!box) return;
  const pageSize = opts.pageSize || 10;
  function draw() {
    const term = st.term.trim().toLowerCase();
    const filtered = (term && opts.match) ? items.filter(it => opts.match(it, term)) : items;
    const pages = Math.max(1, Math.ceil(filtered.length / pageSize));
    if (st.page > pages) st.page = pages;
    if (st.page < 1) st.page = 1;
    const pageItems = filtered.slice((st.page - 1) * pageSize, st.page * pageSize);
    const toolbar = opts.hideSearch
      ? `<div class="list-toolbar"><span></span><span class="list-count">${filtered.length} ${opts.noun || "items"}</span></div>`
      : `<div class="list-toolbar"><input class="list-search" type="search" placeholder="${opts.placeholder || "Search…"}" value="${st.term.replace(/"/g,"&quot;")}"/><span class="list-count">${filtered.length} ${opts.noun || "items"}</span></div>`;
    box.innerHTML = `${toolbar}
      ${filtered.length ? opts.render(pageItems) : `<p class="empty">${opts.empty || "Nothing found."}</p>`}
      <div class="pager">
        <button class="btn sm" data-pg="prev" ${st.page <= 1 ? "disabled" : ""}>‹ Prev</button>
        <span>Page ${st.page} of ${pages}</span>
        <button class="btn sm" data-pg="next" ${st.page >= pages ? "disabled" : ""}>Next ›</button>
      </div>`;
    const search = box.querySelector(".list-search");
    if (search) search.oninput = (e) => { st.term = e.target.value; st.page = 1; draw();
      const s = box.querySelector(".list-search"); s.focus(); s.setSelectionRange(s.value.length, s.value.length); };
    box.querySelectorAll("[data-pg]").forEach(b => b.onclick = () => { st.page += b.dataset.pg === "next" ? 1 : -1; draw(); });
  }
  draw();
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

// ---------- Take a quiz (student) ----------
async function callQuiz(payload) {
  const { data: { session } } = await sb.auth.getSession();
  const res = await fetch(`${SUPABASE_URL}/functions/v1/quiz`, {
    method: "POST",
    headers: { Authorization: `Bearer ${session.access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify(payload),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error || "Quiz error");
  return body;
}

function ensureQuizModal() {
  let m = document.getElementById("quiz-modal");
  if (!m) {
    m = document.createElement("div");
    m.id = "quiz-modal";
    m.style.cssText = "display:none;position:fixed;inset:0;background:rgba(0,0,0,.5);z-index:60;align-items:center;justify-content:center;padding:16px";
    m.innerHTML = `<div class="card" style="width:100%;max-width:600px;max-height:88vh;overflow:auto">
      <h3 id="quiz-title">Quiz</h3><div id="quiz-body"></div>
      <div class="row-actions" style="margin-top:12px">
        <button class="btn green" id="quiz-submit">Submit</button>
        <button class="btn" style="background:#e5e7eb" onclick="document.getElementById('quiz-modal').style.display='none'">Close</button>
      </div></div>`;
    document.body.appendChild(m);
  }
  return m;
}

async function openQuiz(quizId) {
  ensureQuizModal().style.display = "flex";
  document.getElementById("quiz-body").innerHTML = '<p class="empty">Loading…</p>';
  let data;
  try { data = await callQuiz({ action: "take", quiz_id: quizId }); }
  catch (e) { document.getElementById("quiz-body").innerHTML = `<p class="empty">${esc(e.message)}</p>`; return; }
  window._quiz = { id: quizId, questions: data.questions };
  document.getElementById("quiz-title").textContent = data.title;
  const priorNote = data.prior ? `<div class="msg ok" style="display:block">Previous score: ${data.prior.score}/${data.prior.total}. You can retake it.</div>` : "";
  document.getElementById("quiz-body").innerHTML = priorNote + data.questions.map((q, i) => `
    <div class="card" style="margin-bottom:10px">
      <div style="font-weight:500;margin-bottom:6px">${i + 1}. ${esc(q.prompt)}</div>
      ${(q.options || []).map((opt, oi) => `<label style="display:flex;gap:8px;align-items:center;padding:4px 0">
        <input type="radio" name="q-${q.id}" value="${oi}"/> ${esc(opt)}</label>`).join("")}
    </div>`).join("");
  document.getElementById("quiz-submit").onclick = submitQuiz;
  document.getElementById("quiz-submit").style.display = "";
}

async function submitQuiz() {
  const answers = {};
  window._quiz.questions.forEach(q => {
    const sel = document.querySelector(`input[name="q-${q.id}"]:checked`);
    if (sel) answers[q.id] = Number(sel.value);
  });
  let res;
  try { res = await callQuiz({ action: "submit", quiz_id: window._quiz.id, answers }); }
  catch (e) { alert(e.message); return; }
  document.getElementById("quiz-submit").style.display = "none";
  // Show score and mark correct/incorrect.
  window._quiz.questions.forEach(q => {
    const chosen = answers[q.id];
    const right = res.correct[q.id];
    document.querySelectorAll(`input[name="q-${q.id}"]`).forEach(inp => {
      const oi = Number(inp.value);
      const lbl = inp.parentElement;
      if (oi === right) lbl.style.color = "#166534";
      else if (oi === chosen) lbl.style.color = "#991b1b";
      inp.disabled = true;
    });
  });
  const b = document.getElementById("quiz-body");
  b.insertAdjacentHTML("afterbegin", `<div class="msg ok" style="display:block">You scored ${res.score}/${res.total} 🎉</div>`);
  if (typeof onQuizSubmitted === "function") onQuizSubmitted();
}
