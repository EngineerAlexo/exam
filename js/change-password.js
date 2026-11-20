// ============================================================
// First-login password change (change-password.html)
// ============================================================
(async () => {
  const p = await guard('student');
  if (!p) return;
  $('hello').textContent = `Hello ${p.full_name || p.username}, please set your new private password.`;

  $('pwForm').onsubmit = async e => {
    e.preventDefault();
    const a = $('newPass').value;
    const b = $('confirmPass').value;
    if (a.length < 8) return toast('Use at least 8 characters', 'error');
    if (a !== b) return toast('Passwords do not match', 'error');
    if (typeof DEFAULT_STUDENT_PASSWORD !== 'undefined' && a === DEFAULT_STUDENT_PASSWORD) {
      return toast('Please choose a different password, not the default password', 'error');
    }

    const btn = e.target.querySelector('button');
    btn.disabled = true;
    btn.textContent = 'Updating password…';
    const { error } = await sb.auth.updateUser({ password: a });
    if (error) {
      btn.disabled = false;
      btn.textContent = 'Save and continue';
      return toast(error.message, 'error');
    }

    await sb.rpc('finish_password_change');   // clears the must-change flag
    toast('Password updated successfully. Welcome!', 'success');
    setTimeout(() => location.replace('student/dashboard.html'), 700);
  };
})();
