// ============================================================
// Login page (index.html)
// ============================================================
(async () => {
  const urlParams = new URLSearchParams(location.search);
  const isLoggedOut = urlParams.get('logged_out') === '1';

  if (isLoggedOut) {
    // Explicitly clean up URL and local storage to prevent bounce-back
    history.replaceState(null, '', location.pathname);
    try {
      await sb.auth.signOut({ scope: 'local' });
      for (let i = localStorage.length - 1; i >= 0; i--) {
        const key = localStorage.key(i);
        if (key && (key.startsWith('sb-') || key.includes('auth-token'))) {
          localStorage.removeItem(key);
        }
      }
    } catch (e) {}
  } else {
    // Only auto-redirect if there is a genuinely verified active session
    const existing = await getProfile();
    if (existing) return routeAfterLogin(existing);
  }

  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const id = $('username').value.trim().toLowerCase();
    // Admins type their email; students type their username
    const email = id.includes('@') ? id : `${id}@${STUDENT_EMAIL_DOMAIN}`;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Signing in…';
    const { error } = await sb.auth.signInWithPassword({ email, password: $('password').value });
    btn.disabled = false;
    btn.textContent = 'Sign in';
    if (error) return toast('Wrong username or password', 'error');
    routeAfterLogin(await getProfile());
  };
})();

function routeAfterLogin(p) {
  if (!p) {
    toast('This account has no profile. Contact the administrator.', 'error');
    return logout();
  }
  if (p.role === 'admin') location.replace('admin/dashboard.html');
  else if (p.must_change_password) location.replace('change-password.html');
  else location.replace('student/dashboard.html');
}
