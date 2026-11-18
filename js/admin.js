// ============================================================
// Admin dashboard (admin/dashboard.html)
// Tabs: Students · Exams · Questions · Results
// ============================================================
(async () => {
  const p = await guard('admin');
  if (!p) return;
  $('whoami').textContent = p.username;
  $('logout').onclick = logout;

  // Calls the Edge Function directly so we can report the real cause of a failure.
  // (The function holds the service key on the server side only.)
  const FN_URL = `${SUPABASE_URL}/functions/v1/create-students`;

  async function callFn(body) {
    const { data: { session } } = await sb.auth.getSession();
    if (!session) throw new Error('Your session expired. Please sign in again.');

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
    if (res.status === 401) throw new Error('Not authorised. Sign out, sign in again, and retry.');
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

  async function loadStudents() {
    const { data, error } = await sb.from('profiles')
      .select('username, full_name, must_change_password, created_at')
      .eq('role', 'student').order('username');
    if (error) return toast(error.message, 'error');
    $('studentCount').textContent = data.length;
    $('studentsBody').innerHTML = data.length ? data.map((s, i) => `
      <tr>
        <td>${i + 1}</td>
        <td><code>${esc(s.username)}</code></td>
        <td>${esc(s.full_name)}</td>
        <td>${s.must_change_password ? '<span class="badge warn">Must change password</span>' : '<span class="badge ok">Active</span>'}</td>
        <td>${fmt(s.created_at)}</td>
        <td><button class="btn btn-sm btn-ghost" data-reset="${esc(s.username)}">Reset password</button></td>
      </tr>`).join('') : '<tr><td colspan="6" class="muted">No students yet</td></tr>';
  }

  function renderCreds() {
    $('credBox').hidden = !lastCreds.length;
    $('credBody').innerHTML = lastCreds.map((c, i) => `
      <tr><td>${i + 1}</td><td><code>${esc(c.username)}</code></td>
      <td><code>${esc(c.password)}</code></td><td>${esc(c.full_name)}</td></tr>`).join('');
  }

  $('genForm').onsubmit = async e => {
    e.preventDefault();
    const prefix = $('prefix').value.trim().toLowerCase().replace(/\s+/g, '');
    const start = Math.max(1, Number($('startNo').value) || 1);
    const names = $('names').value.split('\n').map(s => s.trim()).filter(Boolean);
    const count = names.length || Number($('count').value) || 0;
    if (!prefix) return toast('Enter a username prefix', 'error');
    if (count < 1 || count > 200) return toast('Create between 1 and 200 students at a time', 'error');

    const rows = Array.from({ length: count }, (_, i) => ({
      username: prefix + String(start + i).padStart(3, '0'),
      password: randomPassword(),
      full_name: names[i] || ''
    }));

    const btn = $('genBtn');
    btn.disabled = true;
    btn.textContent = 'Creating accounts…';
    try {
      const data = await callFn({ students: rows });
      const ok = new Set(data.results.filter(r => r.ok).map(r => r.username));
      const failed = data.results.filter(r => !r.ok);
      lastCreds = rows.filter(r => ok.has(r.username));
      renderCreds();
      if (failed.length) toast(`${lastCreds.length} created, ${failed.length} failed: ${failed[0].username} (${failed[0].error})`, 'error');
      else toast(`${lastCreds.length} accounts created`, 'success');
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

  $('studentsBody').onclick = async e => {
    const b = e.target.closest('button[data-reset]');
    if (!b) return;
    const username = b.dataset.reset;
    if (!confirm(`Reset the password for ${username}? The student must change it at next login.`)) return;
    const password = randomPassword();
    try {
      await callFn({ action: 'reset', username, password });
      lastCreds = [{ username, password, full_name: '' }];
      renderCreds();
      toast('Password reset. Copy it now.', 'success');
    } catch (err) {
      toast(err.message, 'error');
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

  async function loadQuestions() {
    const examId = $('qExam').value;
    if (!examId) { $('qTable').innerHTML = ''; $('qCount').textContent = 0; return; }
    const { data, error } = await sb.from('questions')
      .select('id, position, question_text, answer_keys(correct_option)')
      .eq('exam_id', examId).order('position');
    if (error) return toast(error.message, 'error');
    $('qCount').textContent = data.length;
    $('qTable').innerHTML = data.map(q => {
      const ak = Array.isArray(q.answer_keys) ? q.answer_keys[0] : q.answer_keys;
      return `<tr>
        <td>${q.position}</td>
        <td>${esc(q.question_text)}</td>
        <td><span class="badge ok">${esc(ak?.correct_option ?? '?')}</span></td>
        <td><button class="btn btn-sm btn-danger" data-del="${q.id}">Delete</button></td>
      </tr>`;
    }).join('') || '<tr><td colspan="4" class="muted">No questions yet</td></tr>';
  }

  $('qExam').onchange = loadQuestions;
  $('qTable').onclick = async e => {
    const id = e.target.closest('button[data-del]')?.dataset.del;
    if (!id || !confirm('Delete this question?')) return;
    const { error } = await sb.from('questions').delete().eq('id', id);
    if (error) toast(error.message, 'error');
    loadQuestions();
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
  await loadStudents();
  await loadExams();
})();
