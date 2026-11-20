// ============================================================
// Student dashboard (student/dashboard.html)
// ============================================================

// Helpers (prefixed so they never clash with common.js)
function dashInitials(name) {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
}

function dashUntil(ms) {
  const mins = Math.floor(ms / 60000);
  if (mins < 1) return 'less than a minute';
  if (mins < 60) return `${mins} min`;
  const hrs = Math.floor(mins / 60);
  if (hrs < 48) return `${hrs} h ${mins % 60} min`;
  return `${Math.floor(hrs / 24)} days`;
}

// Builds the card HTML and its status for one exam
function dashCard(e, a, now) {
  const opensMs = e.opens_at ? new Date(e.opens_at).getTime() : null;
  const closesMs = e.closes_at ? new Date(e.closes_at).getTime() : null;
  const notOpen = opensMs !== null && now < opensMs;
  const closed = closesMs !== null && now > closesMs;
  const pct = a?.submitted_at ? Number(a.percentage) : null;
  const passed = pct !== null && pct >= Number(e.pass_mark);
  let state, order, pill, mid, act;

  if (a?.submitted_at) {
    state = 'done'; order = 3;
    pill = `<span class="pill ${passed ? 'ok' : 'bad'}">${passed ? 'Passed' : 'Failed'}</span>`;
    mid = `<div class="result">
             <div class="ring" style="--p:${Math.round(pct)};--c:${passed ? '#16a34a' : '#dc2626'}"><span>${Math.round(pct)}%</span></div>
             <div><b>${a.score} / ${a.total}</b><small>correct answers</small><small>Pass mark ${e.pass_mark}%</small></div>
           </div>`;
    act = `<a class="act act-ghost" href="exam.html?id=${e.id}&review=1">Review answers →</a>`;
  } else if (a) {
    state = 'progress'; order = 0;
    pill = '<span class="pill warn">In progress</span>';
    mid = '<p class="note">You started this exam. Continue where you left off.</p>';
    act = `<a class="act act-primary" href="exam.html?id=${e.id}">Resume exam →</a>`;
  } else if (closed) {
    state = 'missed'; order = 4;
    pill = '<span class="pill muted">Closed</span>';
    mid = '<p class="note">The exam window has closed and this exam was not taken.</p>';
    act = '<span class="act act-off">Not available</span>';
  } else if (notOpen) {
    state = 'soon'; order = 2;
    pill = '<span class="pill info">Upcoming</span>';
    mid = `<p class="note">Opens <b>${fmt(e.opens_at)}</b></p>`;
    act = '<span class="act act-off">Not open yet</span>';
  } else {
    state = 'avail'; order = 1;
    pill = '<span class="pill ok">Available</span>';
    mid = closesMs !== null
      ? `<p class="note">Closes ${fmt(e.closes_at)} · <b>${dashUntil(closesMs - now)} left</b></p>`
      : '<p class="note">Open now, no closing time.</p>';
    act = `<a class="act act-primary" href="exam.html?id=${e.id}">Start exam →</a>`;
  }

  const html = `
    <article class="exam-card st-${state}">
      <div class="exam-top-row">
        <span class="course">${esc(e.course || 'Exam')}</span>
        ${pill}
      </div>
      <h3>${esc(e.title)}</h3>
      <div class="meta"><span>⏱ ${e.duration_minutes} min</span><span>🎯 Pass ${e.pass_mark}%</span></div>
      ${mid}
      <div class="card-foot">${act}</div>
    </article>`;

  return { state, order, passed, pct: pct ?? 0, html };
}

(async () => {
  const p = await guard('student');
  if (!p) return;

  const name = p.full_name || p.username || 'Student';
  const hour = new Date().getHours();
  const hello = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';

  $('welcome').textContent = name;
  $('avatar').textContent = dashInitials(name);
  $('greet').textContent = `${hello}, ${name.split(/\s+/)[0]}`;
  $('today').textContent = new Date().toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric'
  });
  $('logout').onclick = async (e) => {
    e.preventDefault();
    $('logout').disabled = true;
    $('logout').textContent = 'Logging out…';
    await logout();
  };

  const [{ data: exams, error: e1 }, { data: attempts, error: e2 }] = await Promise.all([
    sb.from('exams').select('*').eq('published', true).order('opens_at', { ascending: true, nullsFirst: true }),
    sb.from('attempts').select('*').eq('student_id', p.id)
  ]);

  if (e1 || e2) {
    $('examGrid').innerHTML = '<div class="empty">Could not load your exams. Refresh the page or sign in again.</div>';
    return;
  }

  const byExam = Object.fromEntries((attempts || []).map(a => [a.exam_id, a]));
  const now = Date.now();
  const cards = (exams || []).map(e => dashCard(e, byExam[e.id], now));
  cards.sort((x, y) => x.order - y.order); // stable: keeps date order within each group

  const done = cards.filter(c => c.state === 'done');
  const active = cards.filter(c => c.state === 'avail' || c.state === 'progress');
  const passedCount = done.filter(c => c.passed).length;
  const avg = done.length ? done.reduce((s, c) => s + c.pct, 0) / done.length : null;

  $('statAvail').textContent = active.length;
  $('statDone').textContent = done.length;
  $('statAvg').textContent = avg === null ? '—' : avg.toFixed(1) + '%';
  $('statPass').textContent = done.length ? Math.round((passedCount / done.length) * 100) + '%' : '—';

  $('heroSub').textContent = active.length
    ? `You have ${active.length} exam${active.length > 1 ? 's' : ''} ready to take.`
    : done.length
      ? 'You are all caught up. You can review your past answers any time.'
      : 'No exams are open for you right now.';

  $('examCount').textContent = cards.length ? `${cards.length} published` : '';

  $('examGrid').innerHTML = cards.length
    ? cards.map(c => c.html).join('')
    : '<div class="empty">📭 No exams are published yet. Check back later.</div>';
})();
