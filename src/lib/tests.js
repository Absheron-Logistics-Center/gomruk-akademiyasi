// tests.js — question checks and saved test sessions.
// A running test is kept in this browser per account, so leaving the page or
// closing the tab does not lose answers; it opens again where it stopped.

export const PAGE_SIZE = 10;

export function niceTime(s) {
  s = Math.floor(Math.max(0, s));
  return `${String(Math.floor(s / 3600)).padStart(2, '0')}:${String(Math.floor(s / 60) % 60).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`;
}

const optionList = (q) => (Array.isArray(q?.options) ? q.options : []);
export { optionList };

// '' when the question can be answered, otherwise why it cannot (never guess)
export function problemOf(q) {
  const opts = optionList(q), keys = opts.map(o => o.key), correct = q?.correct_answers;
  if (!['single', 'multiple'].includes(q?.type)) return 'Sualın növü müəyyən edilmir';
  if (opts.length < 2 || !keys.every(k => typeof k === 'string' && /^[A-E]$/.test(k))) return 'Cavab variantlarının strukturu natamamdır';
  if (!Array.isArray(correct) || !correct.length || !correct.every(k => keys.includes(k))) return 'Düzgün cavab açarı müəyyən edilmir';
  if (q.type === 'single' && correct.length !== 1) return 'Təkseçimli sualın cavab açarı uyğunsuzdur';
  return '';
}

export function isRight(q, answer) {
  return !problemOf(q) && Array.isArray(answer) && answer.length === q.correct_answers.length &&
    [...answer].sort().join(',') === [...q.correct_answers].sort().join(',');
}

export function results(s) {
  const states = s.questions.map((q, i) => {
    const a = s.answers[i] || [];
    return !a.length ? 'blank' : isRight(q, a) ? 'right' : 'wrong';
  });
  const right = states.filter(x => x === 'right').length;
  const blank = states.filter(x => x === 'blank').length;
  const n = s.questions.length || 1;
  return { states, right, blank, wrong: s.questions.length - right - blank, pct: Math.round((right / n) * 1000) / 10 };
}

export const answered = (s) => s.questions.filter((_, i) => (s.answers[i] || []).length > 0).length;

export function elapsed(s) {
  return Math.floor((s.elapsedMs + (s.runningSince ? Date.now() - s.runningSince : 0)) / 1000);
}

export function newSession({ key, type, id, name, mode, questions, stamp, limitMin, subset = false }) {
  return {
    v: 1, key, type, id, name, mode, stamp, subset,
    stage: 'running', questions, answers: {}, checked: {}, marked: [],
    page: 0, focus: 0, elapsedMs: 0, runningSince: Date.now(), filter: 'all',
    limit: limitMin ? limitMin * 60 : 0, startedAt: new Date().toISOString()
  };
}

export function pause(s) {
  if (s && s.stage === 'running' && s.runningSince) {
    return { ...s, elapsedMs: s.elapsedMs + (Date.now() - s.runningSince), runningSince: null };
  }
  return s;
}
export function resume(s) {
  if (s && s.stage === 'running' && !s.runningSince) return { ...s, runningSince: Date.now() };
  return s;
}

/* ------------------------------ saved sessions ------------------------------ */
const sk = (user, key) => `ga.test.${user || 'anon'}.${key}`;
export function loadSession(user, key) {
  try {
    const s = JSON.parse(localStorage.getItem(sk(user, key)) || 'null');
    return s && s.v === 1 ? s : null;
  } catch { return null; }
}
export function storeSession(user, s) {
  try {
    if (!s) return;
    localStorage.setItem(sk(user, s.key), JSON.stringify(s));
  } catch { /* storage full: the test keeps running in memory */ }
}
export function dropSession(user, key) {
  try { localStorage.removeItem(sk(user, key)); } catch { /* ignore */ }
}
export function runningSessions(user) {
  const out = [];
  try {
    const pre = `ga.test.${user || 'anon'}.`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k?.startsWith(pre)) continue;
      const s = JSON.parse(localStorage.getItem(k) || 'null');
      if (s?.stage === 'running') out.push(s);
    }
  } catch { /* ignore */ }
  return out;
}
