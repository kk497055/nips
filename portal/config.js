// NIPS Portal — Supabase client config
// NOTE: only the PUBLISHABLE (anon) key belongs here. Never put the secret key in frontend code.
const SUPABASE_URL = "https://qajupsfbmbmbrjlqpstx.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qPM05rVcSDylY3K_viaksw_D-31dW90";

const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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
