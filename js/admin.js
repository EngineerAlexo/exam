// ============================================================
// Admin dashboard (admin/dashboard.html)
// Tabs: Students · Exams · Questions · Results
// ============================================================
(async () => {
  const p = await guard('admin');
  if (!p) return;
  $('whoami').textContent = p.username;
  $('logout').onclick = async (e) => {
    e.preventDefault();
    $('logout').disabled = true;
    $('logout').textContent = 'Logging out…';
    await logout();
  };

  // Calls the Edge Function directly so we can report the real cause of a failure.
  // (The function holds the service key on the server side only.)
  const FN_URL = `${SUPABASE_URL}/functions/v1/create-students`;

  async function callFn(body) {
    let { data: { session } } = await sb.auth.getSession();
    if (!session) {
      toast('Session expired. Signing out…', 'error');
      setTimeout(logout, 1200);
      throw new Error('Your session expired. Please sign in again.');
    }

    // Refresh token if near expiration or expired
    const exp = session.expires_at ? session.expires_at * 1000 : 0;
    if (exp && Date.now() > exp - 60000) {
      const { data: ref } = await sb.auth.refreshSession();
      if (ref?.session) session = ref.session;
    }

    let res;
    try {
      res = await fetch(FN_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'apikey': SUPABASE_ANON_KEY,
          'Authorization': `Bearer ${session.access_token}`
        },
        body: JSON.stringify(body)
      });
    } catch {
      // Network error or CORS block. Usually means the function is NOT deployed
      // under the exact name "create-students" in this project.
      throw new Error('Cannot reach the create-students function. Deploy it in Supabase → Edge Functions with exactly this name (see README step D).');
    }

    let json = {};
    try { json = await res.json(); } catch { /* empty body */ }

    if (res.status === 404) throw new Error('create-students is not deployed in this project (404).');
    if (res.status === 401) {
      toast('Your session expired. Signing you out to sign in again…', 'error');
      setTimeout(logout, 1500);
      throw new Error('Not authorised. Sign out, sign in again, and retry.');
    }
    if (!res.ok || json.error) throw new Error(json.error || `Request failed with status ${res.status}`);
    return json;
  }

  // ---------- tabs ----------
  document.querySelectorAll('.tab').forEach(btn => btn.onclick = () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b === btn));
    document.querySelectorAll('.tab-panel').forEach(s => (s.hidden = s.id !== 'tab-' + btn.dataset.tab));
    if (btn.dataset.tab === 'results') loadResults();
  });

  // =========================================================
  // STUDENTS
  // =========================================================
  let lastCreds = [];
  const selectedStudents = new Set();

  function updateStudentSelectionUI() {
    const count = selectedStudents.size;
    const batchBox = $('studentBatchActions');
    const label = $('selectedCountLabel');
    const selectAll = $('selectAllStudents');

    if (batchBox) batchBox.hidden = count === 0;
    if (label) label.textContent = `${count} selected`;

    const allCheckboxes = document.querySelectorAll('.stu-chk');
    if (selectAll) {
      selectAll.checked = allCheckboxes.length > 0 && selectedStudents.size === allCheckboxes.length;
      selectAll.indeterminate = selectedStudents.size > 0 && selectedStudents.size < allCheckboxes.length;
    }
  }

  async function loadStudents() {
    const { data, error } = await sb.from('profiles')
      .select('username, full_name, must_change_password, created_at')
      .eq('role', 'student').order('username');
    if (error) return toast(error.message, 'error');
    $('studentCount').textContent = data.length;
    selectedStudents.clear();
    updateStudentSelectionUI();

    $('studentsBody').innerHTML = data.length ? data.map((s, i) => `
      <tr>
        <td style="text-align:center;"><input type="checkbox" class="stu-chk" data-username="${esc(s.username)}"></td>
        <td>${i + 1}</td>
        <td><code>${esc(s.username)}</code></td>
        <td>${esc(s.full_name || '—')}</td>
        <td>${s.must_change_password ? '<span class="badge warn">Must change password</span>' : '<span class="badge ok">Active</span>'}</td>
        <td>${fmt(s.created_at)}</td>
        <td class="actions" style="justify-content:flex-end;">
          <button class="btn btn-sm btn-ghost" data-reset="${esc(s.username)}">Reset password</button>
          <button class="btn btn-sm btn-danger" data-del-stu="${esc(s.username)}" title="Delete student">Delete</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="7" class="muted">No students yet</td></tr>';
  }

  $('selectAllStudents').onchange = (e) => {
    const checked = e.target.checked;
    document.querySelectorAll('.stu-chk').forEach(chk => {
      chk.checked = checked;
      const u = chk.dataset.username;
      if (checked) selectedStudents.add(u);
      else selectedStudents.delete(u);
    });
    updateStudentSelectionUI();
  };

  $('studentsBody').onchange = (e) => {
    const chk = e.target.closest('.stu-chk');
    if (!chk) return;
    const u = chk.dataset.username;
    if (chk.checked) selectedStudents.add(u);
    else selectedStudents.delete(u);
    updateStudentSelectionUI();
  };

  async function deleteStudentAccounts(usernames) {
    if (!usernames || !usernames.length) return;
    const count = usernames.length;
    const msg = count === 1
      ? `Permanently delete student account "${usernames[0]}"? This cannot be undone.`
      : `Permanently delete ${count} selected student account(s)? This cannot be undone.`;

    if (!confirm(msg)) return;

    let deletedCount = 0;

    // 1. Try database RPC delete_student_accounts (fastest & purges both auth.users and profiles)
    try {
      const { data: rpcData, error: rpcErr } = await sb.rpc('delete_student_accounts', { p_usernames: usernames });
      if (!rpcErr && Array.isArray(rpcData) && rpcData.length > 0) {
        deletedCount = rpcData.length;
      }
    } catch (e) {
      console.warn('RPC delete error:', e);
    }

    // 2. If RPC is not installed, try Edge Function (verifying it actually returned deleted array)
    if (deletedCount === 0) {
      try {
        const fnRes = await callFn({ action: 'delete', usernames });
        if (fnRes && fnRes.ok && Array.isArray(fnRes.deleted) && fnRes.deleted.length > 0) {
          deletedCount = fnRes.deleted.length;
        }
      } catch (fnErr) {
        console.warn('callFn delete error:', fnErr);
      }
    }

    // 3. Direct delete from public.profiles table (immediately removes from dashboard & database)
    if (deletedCount === 0) {
      try {
        const { data: delProfiles, error: pErr } = await sb.from('profiles')
          .delete()
          .in('username', usernames)
          .select('username');

        if (pErr) {
          return toast('Delete failed: ' + pErr.message, 'error');
        }
        deletedCount = delProfiles?.length || 0;
      } catch (pEx) {
        return toast('Delete failed: ' + pEx.message, 'error');
      }
    }

    if (deletedCount > 0) {
      toast(`Successfully deleted ${deletedCount} student account(s)`, 'success');
    } else {
      toast('Could not delete the selected students. Please ensure you are logged in as admin.', 'error');
    }

    selectedStudents.clear();
    await loadStudents();
  }

  $('deleteSelectedStudentsBtn').onclick = () => {
    deleteStudentAccounts(Array.from(selectedStudents));
  };

  function renderCreds() {
    $('credBox').hidden = !lastCreds.length;
    $('credBody').innerHTML = lastCreds.map((c, i) => `
      <tr><td>${i + 1}</td><td><code>${esc(c.username)}</code></td>
      <td><code>${esc(c.password)}</code></td><td>${esc(c.full_name)}</td></tr>`).join('');
  }

  function buildUsernames(rawPrefix, startVal, rawSuffix, padOption, count) {
    let prefix = String(rawPrefix || '').trim().replace(/\s+/g, '');
    let suffix = String(rawSuffix || '').trim().replace(/\s+/g, '');
    let pad = parseInt(padOption, 10);

    // Smart detection: If user typed e.g. "RU0204/16" into the Prefix field and left Suffix blank
    if (!suffix && prefix.includes('/')) {
      const slashIdx = prefix.lastIndexOf('/');
      const afterSlash = prefix.slice(slashIdx); // e.g. "/16"
      const beforeSlash = prefix.slice(0, slashIdx); // e.g. "RU0204"
      const numMatch = beforeSlash.match(/^(.*?)(\d+)$/);
      if (numMatch) {
        prefix = numMatch[1];
        if (!startVal || startVal === '1' || startVal === '0204') {
          startVal = numMatch[2];
        }
        suffix = afterSlash;
        if (isNaN(pad) || pad === 0) {
          pad = numMatch[2].length;
        }
      } else {
        suffix = afterSlash;
        prefix = beforeSlash;
      }
    }

    const startStr = String(startVal || '1').trim();
    const startNum = parseInt(startStr, 10) || 1;

    if (isNaN(pad)) {
      pad = startStr.length > 1 ? startStr.length : 4;
    }

    const list = [];
    for (let i = 0; i < count; i++) {
      const num = startNum + i;
      const numStr = pad > 0 ? String(num).padStart(pad, '0') : String(num);
      list.push(`${prefix}${numStr}${suffix}`);
    }
    return list;
  }

  function updateUsernamePreview() {
    const p = $('prefix')?.value || 'RU';
    const startVal = $('startNo')?.value || '0204';
    const s = $('suffix')?.value || '';
    const pad = $('padDigits')?.value || '4';
    const names = $('names')?.value.split('\n').map(x => x.trim()).filter(Boolean) || [];
    const count = names.length || Number($('count')?.value) || 3;

    const samples = buildUsernames(p, startVal, s, pad, Math.min(count, 4));
    const more = count > 4 ? ` … (+${count - 4} more)` : '';
    if ($('usernamePreview')) {
      $('usernamePreview').textContent = samples.length ? samples.join(', ') + more : '—';
    }
  }

  ['prefix', 'startNo', 'suffix', 'padDigits', 'count', 'names'].forEach(id => {
    const el = $(id);
    if (el) {
      el.addEventListener('input', updateUsernamePreview);
      el.addEventListener('change', updateUsernamePreview);
    }
  });

  // Auto-detect when user pastes e.g. "RU0204/16" directly into prefix
  $('prefix')?.addEventListener('input', e => {
    const val = e.target.value.trim();
    const m = val.match(/^([a-zA-Z_-]+?)(\d+)(\/[a-zA-Z0-9_-]+)$/);
    if (m) {
      $('prefix').value = m[1];
      $('startNo').value = m[2];
      $('suffix').value = m[3];
      if ($('padDigits')) $('padDigits').value = String(m[2].length);
      updateUsernamePreview();
    }
  });

  $('genForm').onsubmit = async e => {
    e.preventDefault();
    const rawPrefix = $('prefix').value;
    const startVal = $('startNo').value;
    const rawSuffix = $('suffix')?.value || '';
    const padOption = $('padDigits')?.value || '4';

    const names = $('names').value.split('\n').map(s => s.trim()).filter(Boolean);
    const count = names.length || Number($('count').value) || 0;
    if (!rawPrefix && !startVal) return toast('Enter a prefix or starting number', 'error');
    if (count < 1 || count > 200) return toast('Create between 1 and 200 students at a time', 'error');

    const usernames = buildUsernames(rawPrefix, startVal, rawSuffix, padOption, count);

    const useDefault = $('useDefaultPw')?.checked;
    const defaultPw = (typeof DEFAULT_STUDENT_PASSWORD !== 'undefined') ? DEFAULT_STUDENT_PASSWORD : 'Student@123';

    const rows = usernames.map((username, i) => ({
      username,
      password: useDefault ? defaultPw : randomPassword(),
      full_name: names[i] || ''
    }));

    const btn = $('genBtn');
    btn.disabled = true;
    btn.textContent = 'Creating accounts…';
    try {
      const data = await callFn({ students: rows });
      const ok = new Set((data.results || []).filter(r => r.ok).map(r => r.username.toLowerCase()));
      const failed = (data.results || []).filter(r => !r.ok);
      lastCreds = rows.filter(r => ok.has(r.username.toLowerCase()));
      renderCreds();
      if (failed.length) toast(`${lastCreds.length} created, ${failed.length} failed: ${failed[0].username} (${failed[0].error})`, 'error');
      else toast(`${lastCreds.length} accounts created successfully`, 'success');
      loadStudents();
    } catch (err) {
      toast(err.message, 'error');
    } finally {
      btn.disabled = false;
      btn.textContent = 'Generate accounts';
    }
  };

  $('dlCreds').onclick = () => downloadCSV('student-credentials.csv',
    [['Username', 'Password', 'Full name'], ...lastCreds.map(c => [c.username, c.password, c.full_name])]);
  $('printCreds').onclick = () => window.print();

  // Reset password modal handlers
  let targetResetUsername = '';
  const defaultPw = (typeof DEFAULT_STUDENT_PASSWORD !== 'undefined') ? DEFAULT_STUDENT_PASSWORD : 'Student@123';

  function openResetModal(username) {
    targetResetUsername = username;
    $('resetStudentName').textContent = username;
    $('resetPasswordInput').value = defaultPw;
    $('resetFormContainer').hidden = false;
    $('resetSuccessBox').hidden = true;
    $('confirmResetBtn').disabled = false;
    $('confirmResetBtn').textContent = 'Reset to Default Password';
    $('resetModal').hidden = false;
  }

  function closeResetModal() {
    $('resetModal').hidden = true;
    targetResetUsername = '';
  }

  $('closeResetModal').onclick = closeResetModal;
  $('cancelResetBtn').onclick = closeResetModal;

  $('copyDefaultPwBtn').onclick = () => {
    const pw = $('resetPasswordInput').value;
    navigator.clipboard.writeText(pw);
    toast('Default password copied!', 'info');
  };

  $('resetForm').onsubmit = async e => {
    e.preventDefault();
    if (!targetResetUsername) return;
    const password = $('resetPasswordInput').value.trim() || defaultPw;
    if (password.length < 8) return toast('Password must be at least 8 characters', 'error');

    const btn = $('confirmResetBtn');
    btn.disabled = true;
    btn.textContent = 'Resetting password…';

    try {
      await callFn({ action: 'reset', username: targetResetUsername, password });
      // Ensure the must_change_password flag is set in the profiles table as well
      await sb.from('profiles').update({ must_change_password: true }).eq('username', targetResetUsername);

      $('resSuccessUser').textContent = targetResetUsername;
      $('resSuccessPw').textContent = password;
      $('resetFormContainer').hidden = true;
      $('resetSuccessBox').hidden = false;

      lastCreds = [{ username: targetResetUsername, password, full_name: '' }];
      renderCreds();
      await loadStudents();
      toast(`Password for ${targetResetUsername} reset to default!`, 'success');
    } catch (err) {
      toast(err.message, 'error');
      btn.disabled = false;
      btn.textContent = 'Reset to Default Password';
    }
  };

  $('copyCredsDoneBtn').onclick = () => {
    const u = $('resSuccessUser').textContent;
    const p = $('resSuccessPw').textContent;
    const text = `Username: ${u}\nDefault Password: ${p}`;
    navigator.clipboard.writeText(text);
    toast('Credentials copied to clipboard!', 'success');
    closeResetModal();
  };

  $('studentsBody').onclick = async e => {
    const resetBtn = e.target.closest('button[data-reset]');
    if (resetBtn) {
      openResetModal(resetBtn.dataset.reset);
      return;
    }
    const delBtn = e.target.closest('button[data-del-stu]');
    if (delBtn) {
      deleteStudentAccounts([delBtn.dataset.delStu]);
      return;
    }
  };

  // =========================================================
  // EXAMS
  // =========================================================
  let examsCache = [];

  async function loadExams() {
    const { data, error } = await sb.from('exams').select('*, questions(count)').order('created_at', { ascending: false });
    if (error) return toast(error.message, 'error');
    examsCache = data;
    $('examsBody').innerHTML = data.length ? data.map(e => `
      <tr>
        <td><strong>${esc(e.title)}</strong><div class="small muted">${esc(e.course || '')}</div></td>
        <td>${e.duration_minutes} min · pass ${e.pass_mark}%</td>
        <td>${e.questions?.[0]?.count ?? 0}</td>
        <td>${fmt(e.opens_at)}<div class="small muted">to ${fmt(e.closes_at)}</div></td>
        <td>${e.published ? '<span class="badge ok">Published</span>' : '<span class="badge">Draft</span>'}</td>
        <td class="actions">
          <button class="btn btn-sm btn-ghost" data-act="toggle" data-id="${e.id}" data-pub="${e.published}">${e.published ? 'Unpublish' : 'Publish'}</button>
          <button class="btn btn-sm btn-danger" data-act="delete" data-id="${e.id}">Delete</button>
        </td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No exams yet</td></tr>';
    fillExamSelects();
  }

  $('examsBody').onclick = async e => {
    const b = e.target.closest('button[data-act]');
    if (!b) return;
    if (b.dataset.act === 'toggle') {
      const { error } = await sb.from('exams').update({ published: b.dataset.pub !== 'true' }).eq('id', b.dataset.id);
      if (error) toast(error.message, 'error');
    } else if (b.dataset.act === 'delete') {
      if (!confirm('Delete this exam with its questions and all student attempts? This cannot be undone.')) return;
      const { error } = await sb.from('exams').delete().eq('id', b.dataset.id);
      if (error) toast(error.message, 'error');
    }
    loadExams();
  };

  $('examForm').onsubmit = async e => {
    e.preventDefault();
    const row = {
      title: $('exTitle').value.trim(),
      course: $('exCourse').value.trim() || null,
      duration_minutes: Number($('exDuration').value),
      pass_mark: Number($('exPass').value),
      opens_at: $('exOpens').value ? new Date($('exOpens').value).toISOString() : null,
      closes_at: $('exCloses').value ? new Date($('exCloses').value).toISOString() : null,
      published: $('exPublished').checked,
      created_by: p.id
    };
    const { error } = await sb.from('exams').insert(row);
    if (error) return toast(error.message, 'error');
    toast('Exam created', 'success');
    e.target.reset();
    loadExams();
  };

  // =========================================================
  // QUESTIONS
  // =========================================================
  function fillExamSelects() {
    const opts = examsCache.map(e =>
      `<option value="${e.id}">${esc(e.title)}${e.published ? '' : ' (draft)'}</option>`).join('')
      || '<option value="">No exams yet</option>';
    const q = $('qExam'), r = $('resExam');
    const prevQ = q.value, prevR = r.value;
    q.innerHTML = opts;
    r.innerHTML = opts;
    if (examsCache.some(e => e.id === prevQ)) q.value = prevQ;
    if (examsCache.some(e => e.id === prevR)) r.value = prevR;
    loadQuestions();
  }

  function renderPreview(items, errors) {
    $('previewBox').hidden = false;
    $('previewBox').innerHTML = `
      <p><strong>${items.length}</strong> question(s) detected.
        ${errors.length ? `<span class="badge bad">${errors.length} problem(s)</span>` : '<span class="badge ok">Ready to save</span>'}</p>
      ${errors.length ? `<ul class="errors">${errors.map(x => `<li>${esc(x)}</li>`).join('')}</ul>` : ''}
      <div class="preview-list">
        ${items.map((q, i) => `
          <div class="pv">
            <div><strong>${i + 1}. ${esc(q.text)}</strong></div>
            ${['A', 'B', 'C', 'D'].map(L =>
      `<div class="${q.answer === L ? 'pv-correct' : ''}">${L}. ${esc(q.options[L] || '—')}</div>`).join('')}
            <div class="small muted">Answer: ${esc(q.answer || '?')}</div>
          </div>`).join('')}
      </div>`;
  }

  $('qFile').onchange = async e => {
    const f = e.target.files[0];
    if (f) $('qText').value = await f.text();
  };
  $('previewBtn').onclick = () => {
    const { items, errors } = parseQuestions($('qText').value);
    renderPreview(items, errors);
  };

  $('saveBtn').onclick = async () => {
    const examId = $('qExam').value;
    if (!examId) return toast('Create an exam first', 'error');
    const { items, errors } = parseQuestions($('qText').value);
    if (errors.length || !items.length) {
      renderPreview(items, errors);
      return toast('Fix the problems shown in the preview first', 'error');
    }

    const { data: last } = await sb.from('questions').select('position')
      .eq('exam_id', examId).order('position', { ascending: false }).limit(1);
    let pos = last?.[0]?.position ?? 0;

    const qRows = [], kRows = [];
    for (const it of items) {
      const id = crypto.randomUUID();
      pos++;
      qRows.push({
        id, exam_id: examId, position: pos, question_text: it.text,
        option_a: it.options.A, option_b: it.options.B, option_c: it.options.C, option_d: it.options.D
      });
      kRows.push({ question_id: id, correct_option: it.answer });
    }

    $('saveBtn').disabled = true;
    const { error: e1 } = await sb.from('questions').insert(qRows);
    if (e1) { $('saveBtn').disabled = false; return toast(e1.message, 'error'); }

    const { error: e2 } = await sb.from('answer_keys').insert(kRows);
    if (e2) {
      await sb.from('questions').delete().in('id', qRows.map(r => r.id));   // roll back
      $('saveBtn').disabled = false;
      return toast(e2.message, 'error');
    }

    toast(`Saved ${qRows.length} questions`, 'success');
    $('qText').value = '';
    $('previewBox').hidden = true;
    $('saveBtn').disabled = false;
    loadQuestions();
  };

  let questionsCache = [];

  function openEditQModal(id) {
    const q = questionsCache.find(x => x.id === id);
    if (!q) return toast('Question not found', 'error');
    const ak = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;

    $('editQId').value = q.id;
    $('editQPos').value = q.position;
    $('editQText').value = q.question_text || '';
    $('editQOptA').value = q.option_a || '';
    $('editQOptB').value = q.option_b || '';
    $('editQOptC').value = q.option_c || '';
    $('editQOptD').value = q.option_d || '';
    $('editQAnswer').value = ak?.correct_option || 'A';

    $('saveEditQBtn').disabled = false;
    $('saveEditQBtn').textContent = 'Save Changes';
    $('editQModal').hidden = false;
  }

  function closeEditQModal() {
    $('editQModal').hidden = true;
  }

  $('closeEditQModal').onclick = closeEditQModal;
  $('cancelEditQBtn').onclick = closeEditQModal;

  $('editQForm').onsubmit = async e => {
    e.preventDefault();
    const id = $('editQId').value;
    const pos = Number($('editQPos').value) || 1;
    const text = $('editQText').value.trim();
    const optA = $('editQOptA').value.trim();
    const optB = $('editQOptB').value.trim();
    const optC = $('editQOptC').value.trim();
    const optD = $('editQOptD').value.trim();
    const answer = $('editQAnswer').value;

    if (!text || !optA || !optB || !optC || !optD) {
      return toast('Please enter the question text and all 4 options', 'error');
    }

    const btn = $('saveEditQBtn');
    btn.disabled = true;
    btn.textContent = 'Saving…';

    const { error: qErr } = await sb.from('questions').update({
      position: pos,
      question_text: text,
      option_a: optA,
      option_b: optB,
      option_c: optC,
      option_d: optD
    }).eq('id', id);

    if (qErr) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      return toast(qErr.message, 'error');
    }

    const { error: kErr } = await sb.from('answer_keys').upsert({
      question_id: id,
      correct_option: answer
    });

    if (kErr) {
      btn.disabled = false;
      btn.textContent = 'Save Changes';
      return toast(kErr.message, 'error');
    }

    toast('Question updated successfully!', 'success');
    closeEditQModal();
    loadQuestions();
  };

  async function loadQuestions() {
    const examId = $('qExam').value;
    if (!examId) { $('qTable').innerHTML = ''; $('qCount').textContent = 0; return; }
    const { data, error } = await sb.from('questions')
      .select('id, position, question_text, option_a, option_b, option_c, option_d, answer_keys(correct_option)')
      .eq('exam_id', examId).order('position');
    if (error) return toast(error.message, 'error');
    questionsCache = data || [];
    $('qCount').textContent = questionsCache.length;

    $('qTable').innerHTML = questionsCache.map(q => {
      const ak = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
      const ans = ak?.correct_option ?? '?';
      return `<tr>
        <td style="font-weight:700;">${q.position}</td>
        <td>
          <div style="font-weight:600; margin-bottom:8px; line-height:1.4;">${esc(q.question_text)}</div>
          <div style="display:grid; grid-template-columns:1fr 1fr; gap:6px; font-size:12.5px;">
            <div style="padding:4px 8px; border-radius:6px; background:${ans === 'A' ? 'var(--ok-bg)' : '#f8fafc'}; border:1px solid ${ans === 'A' ? 'var(--ok-border)' : 'var(--line)'}; color:${ans === 'A' ? 'var(--ok)' : 'var(--ink)'};">
              <b>A:</b> ${esc(q.option_a || '—')}
            </div>
            <div style="padding:4px 8px; border-radius:6px; background:${ans === 'B' ? 'var(--ok-bg)' : '#f8fafc'}; border:1px solid ${ans === 'B' ? 'var(--ok-border)' : 'var(--line)'}; color:${ans === 'B' ? 'var(--ok)' : 'var(--ink)'};">
              <b>B:</b> ${esc(q.option_b || '—')}
            </div>
            <div style="padding:4px 8px; border-radius:6px; background:${ans === 'C' ? 'var(--ok-bg)' : '#f8fafc'}; border:1px solid ${ans === 'C' ? 'var(--ok-border)' : 'var(--line)'}; color:${ans === 'C' ? 'var(--ok)' : 'var(--ink)'};">
              <b>C:</b> ${esc(q.option_c || '—')}
            </div>
            <div style="padding:4px 8px; border-radius:6px; background:${ans === 'D' ? 'var(--ok-bg)' : '#f8fafc'}; border:1px solid ${ans === 'D' ? 'var(--ok-border)' : 'var(--line)'}; color:${ans === 'D' ? 'var(--ok)' : 'var(--ink)'};">
              <b>D:</b> ${esc(q.option_d || '—')}
            </div>
          </div>
        </td>
        <td><span class="badge ok" style="font-size:13px; font-weight:700;">${esc(ans)}</span></td>
        <td class="actions" style="justify-content:flex-end; white-space:nowrap;">
          <button class="btn btn-sm btn-ghost" data-edit="${q.id}">Edit</button>
          <button class="btn btn-sm btn-danger" data-del="${q.id}">Delete</button>
        </td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No questions yet</td></tr>';
  }

  $('qExam').onchange = loadQuestions;
  $('qTable').onclick = async e => {
    const editBtn = e.target.closest('button[data-edit]');
    if (editBtn) {
      openEditQModal(editBtn.dataset.edit);
      return;
    }
    const delBtn = e.target.closest('button[data-del]');
    if (delBtn) {
      const id = delBtn.dataset.del;
      if (!confirm('Delete this question?')) return;
      const { error } = await sb.from('questions').delete().eq('id', id);
      if (error) toast(error.message, 'error');
      loadQuestions();
    }
  };

  // =========================================================
  // RESULTS
  // =========================================================
  let resultRows = [], resultExam = null;

  async function loadResults() {
    const examId = $('resExam').value;
    if (!examId) return;
    const [{ data: exam }, { data: rows, error }] = await Promise.all([
      sb.from('exams').select('*').eq('id', examId).single(),
      sb.from('attempts').select('*, profiles(username, full_name)')
        .eq('exam_id', examId).order('submitted_at', { ascending: false, nullsFirst: false })
    ]);
    if (error) return toast(error.message, 'error');

    resultRows = rows;
    resultExam = exam;
    const done = rows.filter(r => r.submitted_at);
    const passed = done.filter(r => Number(r.percentage) >= Number(exam.pass_mark)).length;
    const avg = done.length ? (done.reduce((s, r) => s + Number(r.percentage), 0) / done.length).toFixed(1) : '0';

    $('resStats').innerHTML = `
      <div class="stat"><b>${rows.length}</b><span>Started</span></div>
      <div class="stat"><b>${done.length}</b><span>Submitted</span></div>
      <div class="stat"><b>${avg}%</b><span>Average</span></div>
      <div class="stat"><b>${done.length ? Math.round(passed / done.length * 100) : 0}%</b><span>Pass rate</span></div>`;

    $('resBody').innerHTML = rows.map((r, i) => {
      const badge = !r.submitted_at ? '<span class="badge">In progress</span>'
        : Number(r.percentage) >= Number(exam.pass_mark) ? '<span class="badge ok">Passed</span>'
          : '<span class="badge bad">Failed</span>';
      return `<tr>
        <td>${i + 1}</td>
        <td><code>${esc(r.profiles?.username)}</code></td>
        <td>${esc(r.profiles?.full_name)}</td>
        <td>${r.submitted_at ? `${r.score} / ${r.total}` : '—'}</td>
        <td>${r.submitted_at ? r.percentage + '%' : '—'}</td>
        <td>${badge}</td>
        <td>${r.violations}${r.auto_submitted ? ' <span class="badge warn">auto</span>' : ''}</td>
        <td>${fmt(r.submitted_at)}</td>
      </tr>`;
    }).join('') || '<tr><td colspan="8" class="muted">No attempts yet</td></tr>';
  }

  $('resExam').onchange = loadResults;
  $('exportRes').onclick = () => {
    if (!resultExam) return;
    downloadCSV(`${resultExam.title}-results.csv`, [
      ['Username', 'Name', 'Score', 'Total', 'Percent', 'Violations', 'Auto-submitted', 'Submitted'],
      ...resultRows.map(r => [
        r.profiles?.username, r.profiles?.full_name, r.score ?? '', r.total ?? '',
        r.percentage ?? '', r.violations, r.auto_submitted, r.submitted_at ?? ''
      ])
    ]);
  };

  // ---------- initial load ----------
  updateUsernamePreview();
  await loadStudents();
  await loadExams();
})();
