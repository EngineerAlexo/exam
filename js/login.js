// ============================================================
// Login page (index.html)
// ============================================================
(async () => {
  const existing = await getProfile();
  if (existing) return routeAfterLogin(existing);

  $('loginForm').onsubmit = async e => {
    e.preventDefault();
    const id = $('username').value.trim().toLowerCase();
    // Admins type their email; students type their username
    const email = id.includes('@') ? id : `${id}@${STUDENT_EMAIL_DOMAIN}`;
    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.signInWithPassword({ email, password: $('password').value });
    btn.disabled = false;
    if (error) return toast('Wrong username or password', 'error');
    routeAfterLogin(await getProfile());
  };
})();

function routeAfterLogin(p) {
  if (!p) {
    toast('This account has no profile. Contact the administrator.', 'error');
    return sb.auth.signOut();
  }
  if (p.role === 'admin') location.replace('admin/dashboard.html');
  else if (p.must_change_password) location.replace('change-password.html');
  else location.replace('student/dashboard.html');
}
