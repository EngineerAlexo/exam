// ============================================================
// Shared helpers used by every page
// ============================================================
const ROOT = /\/(student|admin)\//.test(location.pathname) ? '../' : '';
const sb = supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

function $(id) { return document.getElementById(id); }

function esc(s) {
  return String(s ?? '').replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function fmt(d) { return d ? new Date(d).toLocaleString() : '—'; }

function toast(msg, type = 'info') {
  const t = document.createElement('div');
  t.className = `toast ${type}`;
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 3800);
}

// Random password without confusing characters (no 0/O, 1/l/I)
function randomPassword(len = 8) {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789';
  const bytes = new Uint32Array(len);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, b => chars[b % chars.length]).join('');
}

function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; }
  catch { return fallback; }
}

function downloadCSV(filename, rows) {
  const csv = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(',')).join('\n');
  const url = URL.createObjectURL(new Blob(['﻿' + csv], { type: 'text/csv;charset=utf-8' }));
  const a = Object.assign(document.createElement('a'), { href: url, download: filename });
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

// Fetch user profile and securely verify that the auth session is actually valid
async function getProfile() {
  try {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) return null;

    // Validate with server
    const { data: { user }, error: userErr } = await sb.auth.getUser();
    if (userErr || !user) {
      try { await sb.auth.signOut({ scope: 'local' }); } catch (e) {}
      return null;
    }

    const { data } = await sb.from('profiles').select('*').eq('id', user.id).maybeSingle();
    return data;
  } catch (err) {
    console.warn('getProfile error:', err);
    return null;
  }
}

// Protects a page. role = 'student' | 'admin'
async function guard(role) {
  const p = await getProfile();
  if (!p) {
    await logout();
    return null;
  }
  if (p.role !== role) {
    location.replace(ROOT + (p.role === 'admin' ? 'admin/dashboard.html' : 'student/dashboard.html'));
    return null;
  }
  if (role === 'student' && p.must_change_password && !location.pathname.endsWith('change-password.html')) {
    location.replace(ROOT + 'change-password.html');
    return null;
  }
  return p;
}

// Absolute, robust logout that clears all cached tokens and stops redirect loops
async function logout() {
  try {
    await sb.auth.signOut({ scope: 'local' });
  } catch (e) {}
  try {
    await sb.auth.signOut();
  } catch (e) {}

  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const key = localStorage.key(i);
      if (key && (key.startsWith('sb-') || key.includes('auth-token') || key.startsWith('exam-'))) {
        localStorage.removeItem(key);
      }
    }
    sessionStorage.clear();
  } catch (e) {}

  location.replace(ROOT + 'index.html?logged_out=1');
}
