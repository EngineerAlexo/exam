// ============================================================
// Exam page (student/exam.html)
// Two modes:
//   taking → navigator, flags, Previous/Next, timer, full-screen enforcement
//   review → after submit: correct answer vs. the student's answer
// ============================================================
(async () => {
  const p = await guard('student');
  if (!p) return;

  const params = new URLSearchParams(location.search);
  const examId = params.get('id');
  const REVIEW = params.get('review') === '1';
  const MAX = EXAM_MAX_VIOLATIONS;
  $('maxV').textContent = MAX;
  $('maxV2').textContent = MAX;

  let exam = null;
  let questions = [];          // taking: exam questions · review: reviewed items
  let cur = 0;                 // current question index
  let st = null;               // taking: { answers, flags, visited }
  let stKey = '', vKey = '';
  let violations = 0;
  let submitting = false, autoTried = false, lastViolation = 0;
  let timerId = null;
  let reviewCur = 0;           // review mode: current question index

  function fail(msg) {
    document.querySelectorAll('.js-submit').forEach(b => (b.hidden = true));
    $('examWrap').hidden = true;
    $('resultBox').hidden = false;
    $('resultBox').innerHTML = `
      <div class="result-card">
        <h2>Something went wrong</h2>
        <p class="notice">${esc(msg)}</p>
        <a class="btn" href="dashboard.html">Back to dashboard</a>
      </div>`;
  }

  if (!examId) return fail('No exam selected.');

  const { data: ex } = await sb.from('exams').select('*').eq('id', examId).maybeSingle();
  if (!ex) return fail('This exam was not found or is not published.');
  exam = ex;
  $('examTitle').textContent = exam.title;
  $('examMeta').textContent = [exam.course, `${exam.duration_minutes} min`, `Pass ${exam.pass_mark}%`]
    .filter(Boolean).join(' · ');

  if (REVIEW) return startReview();
  return startExam();

  // =========================================================
  // TAKING THE EXAM
  // =========================================================
  async function startExam() {
    const { data: attempt, error: startErr } = await sb.rpc('start_exam', { p_exam_id: examId });
    if (startErr) return fail(startErr.message);

    const { data: qs, error: qErr } = await sb.from('questions')
      .select('id, position, question_text, option_a, option_b, option_c, option_d')
      .eq('exam_id', examId).order('position');
    if (qErr || !qs?.length) return fail('This exam has no questions yet.');
    questions = qs;

    // Kept in this browser so a refresh keeps answers, flags and progress
    stKey = `exam-state-${attempt.id}`;
    vKey = `exam-violations-${attempt.id}`;
    st = loadJSON(stKey, { answers: {}, flags: {}, visited: {} });
    violations = Number(localStorage.getItem(vKey) || 0);
    $('vCount').textContent = violations;

    const deadline = new Date(attempt.started_at).getTime() + exam.duration_minutes * 60000;

    const save = () => localStorage.setItem(stKey, JSON.stringify(st));

    // done = answered · left = visited and not answered · todo = not seen yet
    const counts = () => {
      const c = { done: 0, left: 0, todo: 0, flag: 0 };
      questions.forEach(q => {
        if (st.answers[q.id]) c.done++;
        else if (st.visited[q.id]) c.left++;
        else c.todo++;
        if (st.flags[q.id]) c.flag++;
      });
      return c;
    };

    function renderNav() {
      $('navGrid').innerHTML = questions.map((q, i) => {
        const answered = !!st.answers[q.id];
        const cls = answered ? 'done' : st.visited[q.id] ? 'left' : '';
        const label = answered ? 'Answered' : st.visited[q.id] ? 'Left – not answered' : 'Not seen yet';
        return `<button type="button" class="qtile ${cls} ${i === cur ? 'current' : ''}" data-i="${i}"
                  title="Question ${i + 1}: ${label}">${i + 1}${st.flags[q.id] ? '<span class="flag-dot">🚩</span>' : ''}</button>`;
      }).join('');

      const c = counts();
      $('legend').innerHTML = `
        <span><i class="sw done"></i>Answered (${c.done})</span>
        <span><i class="sw left"></i>Left (${c.left})</span>
        <span><i class="sw"></i>Not seen (${c.todo})</span>
        <span>🚩 Flagged (${c.flag})</span>`;
    }

    function renderQuestion() {
      const q = questions[cur];
      const picked = st.answers[q.id];

      $('qLabel').textContent = `Question ${cur + 1} of ${questions.length}`;
      $('qText').textContent = q.question_text;
      $('qOpts').innerHTML = ['A', 'B', 'C', 'D'].map(L => `
        <label class="opt ${picked === L ? 'picked' : ''}">
          <input type="radio" name="ans" value="${L}" ${picked === L ? 'checked' : ''}>
          <span class="letter">${L}</span>
          <span class="otext">${esc(q['option_' + L.toLowerCase()])}</span>
        </label>`).join('');

      const flagged = !!st.flags[q.id];
      $('flagBtn').hidden = false;
      $('flagBtn').classList.toggle('on', flagged);
      $('flagBtn').textContent = flagged ? '🚩 Flagged – click to unflag' : '🚩 Flag as hard';

      $('prevBtn').disabled = cur === 0;
      $('nextBtn').textContent = cur === questions.length - 1 ? 'Review & submit ✓' : 'Next →';
      $('progress').textContent = `${counts().done} of ${questions.length} answered`;
      renderNav();
    }

    // Leaving a question marks it "visited", so if it is still unanswered it shows as "left"
    function goTo(i) {
      if (i === cur) return;
      st.visited[questions[cur].id] = true;
      cur = i;
      save();
      renderQuestion();
    }

    // ----- answering & navigation -----
    $('qOpts').onchange = e => {
      if (e.target.type !== 'radio') return;
      st.answers[questions[cur].id] = e.target.value;
      save();
      renderQuestion();
    };
    $('prevBtn').onclick = () => { if (cur > 0) goTo(cur - 1); };
    $('nextBtn').onclick = () => {
      if (cur === questions.length - 1) submit(false);
      else goTo(cur + 1);
    };
    $('navGrid').onclick = e => {
      const b = e.target.closest('.qtile');
      if (b) goTo(Number(b.dataset.i));
    };
    $('flagBtn').onclick = () => {
      const id = questions[cur].id;
      if (st.flags[id]) delete st.flags[id];
      else st.flags[id] = true;
      save();
      renderQuestion();
    };
    document.addEventListener('keydown', e => {
      if (submitting) return;
      if (e.key === 'ArrowRight' && cur < questions.length - 1) goTo(cur + 1);
      else if (e.key === 'ArrowLeft' && cur > 0) goTo(cur - 1);
      else if (/^[a-d]$/i.test(e.key) && !e.ctrlKey && !e.altKey && !e.metaKey) {
        st.answers[questions[cur].id] = e.key.toUpperCase();
        save();
        renderQuestion();
      }
    });

    // ----- timer -----
    function tick() {
      const left = Math.max(0, Math.floor((deadline - Date.now()) / 1000));
      $('timer').textContent =
        `${String(Math.floor(left / 60)).padStart(2, '0')}:${String(left % 60).padStart(2, '0')}`;
      $('timer').classList.toggle('low', left <= 300);
      if (left === 0 && !autoTried) submit(true, 'Time is up.');
    }
    timerId = setInterval(tick, 1000);
    tick();

    // ----- full-screen enforcement -----
    function showGate(msg) { $('fsMsg').textContent = msg; $('fsOverlay').hidden = false; }
    function hideGate() { $('fsOverlay').hidden = true; }

    async function enterFS() {
      try {
        await document.documentElement.requestFullscreen();
        hideGate();
      } catch {
        toast('The browser blocked full-screen. Click the button again.', 'error');
      }
    }
    $('enterFsBtn').onclick = enterFS;
    if (!document.fullscreenElement) {
      showGate('Click the button below to start the exam in full-screen mode. Stay in full-screen until you submit.');
    }

    function violation(reason) {
      if (submitting) return;
      const now = Date.now();
      if (now - lastViolation < 1500) return;      // ignore duplicate events
      lastViolation = now;
      violations++;
      localStorage.setItem(vKey, String(violations));
      $('vCount').textContent = violations;
      if (violations >= MAX) {
        submit(true, `Automatically submitted after ${violations} violations.`);
        return;
      }
      showGate(`Warning ${violations} of ${MAX}: ${reason}. Click below to return to full-screen.`);
    }

    document.addEventListener('fullscreenchange', () => {
      if (submitting) return;
      if (document.fullscreenElement) hideGate();
      else violation('You left full-screen mode');
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden && !submitting) violation('You switched to another tab or window');
    });

    // ----- light anti-cheating -----
    document.addEventListener('contextmenu', e => e.preventDefault());
    ['copy', 'cut', 'paste'].forEach(ev => document.addEventListener(ev, e => e.preventDefault()));
    document.addEventListener('keydown', e => {
      const k = e.key.toLowerCase();
      if (e.key === 'F12' || e.key === 'PrintScreen' ||
          (e.ctrlKey && ['c', 'v', 'x', 'u', 's', 'p'].includes(k)) ||
          (e.ctrlKey && e.shiftKey && ['i', 'j', 'c'].includes(k))) {
        e.preventDefault();
      }
    });
    window.addEventListener('beforeunload', e => {
      if (!submitting) { e.preventDefault(); e.returnValue = ''; }
    });

    // ----- submit -----
    async function submit(auto = false, reason = '') {
      if (submitting) return;
      if (!auto) {
        const c = counts();
        const unanswered = questions
          .map((q, i) => (st.answers[q.id] ? null : i + 1))
          .filter(Boolean);
        let msg = unanswered.length
          ? `You have ${unanswered.length} unanswered question(s): ${unanswered.join(', ')}.\n\nSubmit anyway?`
          : 'All questions are answered. Submit now?';
        if (c.flag) msg += `\n\n(${c.flag} question(s) are flagged.)`;
        if (!confirm(msg)) return;
      }
      if (auto) autoTried = true;
      submitting = true;
      clearInterval(timerId);

      const payload = {};
      questions.forEach(q => { if (st.answers[q.id]) payload[q.id] = st.answers[q.id]; });

      const { data, error } = await sb.rpc('submit_exam', {
        p_exam_id: examId,
        p_answers: payload,
        p_violations: violations,
        p_auto: auto
      });

      if (error) {
        submitting = false;
        timerId = setInterval(tick, 1000);
        return toast(error.message, 'error');
      }

      localStorage.removeItem(stKey);
      localStorage.removeItem(vKey);
      if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
      showResult(data, reason);
    }
    document.querySelectorAll('.js-submit').forEach(b => (b.onclick = () => submit(false)));

    function showResult(r, reason) {
      document.querySelectorAll('.js-submit').forEach(b => (b.hidden = true));
      hideGate();
      $('examWrap').hidden = true;
      $('resultBox').hidden = false;
      const passed = Number(r.percentage) >= Number(exam.pass_mark);
      $('resultBox').innerHTML = `
        <div class="result-card">
          <div class="emoji">${passed ? '🎉' : '📘'}</div>
          <h2>Exam submitted</h2>
          ${reason ? `<p class="notice">${esc(reason)}</p>` : ''}
          <div class="big-score">${r.score} / ${r.total}</div>
          <p><strong>${r.percentage}%</strong> &nbsp;
            <span class="badge ${passed ? 'ok' : 'bad'}">${passed ? 'Passed' : 'Failed'}</span></p>
          <p class="muted">Pass mark: ${exam.pass_mark}%</p>
          <div class="actions" style="justify-content:center;margin-top:18px">
            <button class="btn" id="reviewNow" type="button">Review my answers</button>
            <a class="btn btn-ghost" href="dashboard.html">Back to dashboard</a>
          </div>
        </div>`;
      $('reviewNow').onclick = () => startReview();
    }

    renderQuestion();
  }

  // =========================================================
  // REVIEW (after submit): correct answers + the student's answers
  // =========================================================
  async function startReview() {
    const { data, error } = await sb.rpc('get_exam_review', { p_exam_id: examId });
    if (error) return fail(error.message);

    questions = data.questions;
    reviewCur = 0;

    document.querySelectorAll('.js-submit').forEach(b => (b.hidden = true));
    $('resultBox').hidden = true;
    $('examWrap').hidden = false;
    $('flagBtn').hidden = true;
    $('warnPill').hidden = true;
    $('timer').textContent = 'Review';
    $('timer').classList.remove('low');

    $('reviewBar').hidden = false;
    $('reviewBar').innerHTML =
      `<strong>Review</strong> · Score ${data.score} / ${data.total} (${data.percentage}%)`;

    $('prevBtn').onclick = () => { if (reviewCur > 0) { reviewCur--; renderReview(); } };
    $('nextBtn').onclick = () => {
      if (reviewCur < questions.length - 1) { reviewCur++; renderReview(); }
      else location.href = 'dashboard.html';
    };
    $('navGrid').onclick = e => {
      const b = e.target.closest('.qtile');
      if (b) { reviewCur = Number(b.dataset.i); renderReview(); }
    };
    document.addEventListener('keydown', e => {
      if (e.key === 'ArrowRight' && reviewCur < questions.length - 1) { reviewCur++; renderReview(); }
      if (e.key === 'ArrowLeft' && reviewCur > 0) { reviewCur--; renderReview(); }
    });

    renderReview();
  }

  function renderReview() {
    const q = questions[reviewCur];
    const sel = q.selected_option;
    const cor = q.correct_option;

    const statusOf = r => (!r.selected_option ? 'skipped' : r.is_correct ? 'correct' : 'wrong');
    $('navGrid').innerHTML = questions.map((r, i) =>
      `<button type="button" class="qtile ${statusOf(r)} ${i === reviewCur ? 'current' : ''}" data-i="${i}"
         title="Question ${i + 1}">${i + 1}</button>`).join('');

    $('legend').innerHTML = `
      <span><i class="sw correct"></i>Correct</span>
      <span><i class="sw wrong"></i>Wrong</span>
      <span><i class="sw skipped"></i>Not answered</span>`;

    const verdict = !sel ? 'Not answered' : q.is_correct ? 'Correct' : 'Wrong';
    $('qLabel').textContent = `Question ${reviewCur + 1} of ${questions.length} · ${verdict}`;
    $('qText').textContent = q.question_text;

    $('qOpts').innerHTML = ['A', 'B', 'C', 'D'].map(L => {
      let cls = 'opt';
      if (L === cor) cls += ' correct';
      if (L === sel && L !== cor) cls += ' wrong';
      const tags = [
        L === sel ? 'Your answer' : '',
        L === cor ? 'Correct answer' : ''
      ].filter(Boolean).map(t => `<em class="tag-ans">${t}</em>`).join('');
      return `<div class="${cls}">
        <span class="letter">${L}</span>
        <span class="otext">${esc(q['option_' + L.toLowerCase()])}</span>
        ${tags}
      </div>`;
    }).join('');

    $('prevBtn').disabled = reviewCur === 0;
    $('nextBtn').textContent = reviewCur === questions.length - 1 ? 'Back to dashboard' : 'Next →';
    $('progress').textContent = `Correct answer: ${cor}` + (sel ? ` · Your answer: ${sel}` : ' · You did not answer');
  }
})();
