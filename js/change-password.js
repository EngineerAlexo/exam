// ============================================================
// First-login password change (change-password.html)
// ============================================================
(async () => {
  const p = await guard('student');
  if (!p) return;
  $('hello').textContent = `Hello ${p.full_name || p.username}, please choose your own password.`;

  $('pwForm').onsubmit = async e => {
    e.preventDefault();
    const a = $('newPass').value;
    const b = $('confirmPass').value;
    if (a.length < 8) return toast('Use at least 8 characters', 'error');
    if (a !== b) return toast('Passwords do not match', 'error');

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) { btn.disabled = false; return toast(error.message, 'error'); }

    await sb.rpc('finish_password_change');   // clears the must-change flag
    toast('Password changed. Welcome!', 'success');
    setTimeout(() => location.replace('student/dashboard.html'), 800);
  };
})();
