// ============================================================
// Question parser: turns plain text into questions.
// Accepted format (one block per question):
//
//   Q1. What is the SI unit of force?
//   A. Joule
//   B. Newton
//   C. Watt
//   D. Pascal
//   Answer: B
//
// "1." / "1)" / "Q1)" / "Q." all work as question numbers.
// ============================================================
const QUESTION_START = /^(?:Q\s*\d*\s*[.):\-]|\d+\s*[.)])\s*(.*)$/i;
const OPTION_LINE = /^([A-Da-d])\s*[.)]\s*(.+)$/;
const ANSWER_LINE = /^(?:answer|ans|correct\s*answer)\s*[:\-]?\s*([A-Da-d])\b/i;

function parseQuestions(text) {
  const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
  const items = [];
  let cur = null;
  const flush = () => { if (cur) items.push(cur); cur = null; };

  for (const line of lines) {
    let m;
    if ((m = line.match(QUESTION_START))) {
      flush();
      cur = { text: m[1].trim(), options: {}, answer: null };
    } else if (!cur) {
      continue;
    } else if ((m = line.match(ANSWER_LINE))) {
      cur.answer = m[1].toUpperCase();
      flush();
    } else if ((m = line.match(OPTION_LINE))) {
      cur.options[m[1].toUpperCase()] = m[2].trim();
    } else if (!Object.keys(cur.options).length) {
      cur.text += ' ' + line;          // question continues on the next line
    }
  }
  flush();

  const errors = [];
  items.forEach((it, i) => {
    const problems = [];
    if (!it.text) problems.push('missing question text');
    ['A', 'B', 'C', 'D'].forEach(L => { if (!it.options[L]) problems.push(`missing option ${L}`); });
    if (!it.answer) problems.push('missing "Answer:" line');
    else if (!it.options[it.answer]) problems.push(`answer ${it.answer} has no option`);
    if (problems.length) errors.push(`Question ${i + 1}: ${problems.join(', ')}`);
  });
  return { items, errors };
}
