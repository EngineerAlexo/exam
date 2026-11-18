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

async function getProfile() {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) return null;
  const { data } = await sb.from('profiles').select('*').eq('id', session.user.id).maybeSingle();
  return data;
}

// Protects a page. role = 'student' | 'admin'
async function guard(role) {
  const { data: { session } } = await sb.auth.getSession();
  if (!session) { location.replace(ROOT + 'index.html'); return null; }

  const p = await getProfile();
  if (!p) {
    toast('This account has no profile. Contact the administrator.', 'error');
    await sb.auth.signOut();
    location.replace(ROOT + 'index.html');
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

async function logout() {
  await sb.auth.signOut();
  location.replace(ROOT + 'index.html');
}
