// TestPanel.jsx — learn / exam modes, 10 questions a page, marks, timer,
// pause and resume, results with review and "work the wrong ones again".
import { useEffect, useRef, useState } from 'react';
import {
  Clock3, CheckCircle2, Circle, Flag, FlagOff, Eraser, ChevronLeft, ChevronRight, Play, RotateCcw,
  GraduationCap, BookOpenCheck, Loader2, XCircle, Target, ListChecks
} from 'lucide-react';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import {
  PAGE_SIZE, niceTime, problemOf, isRight, results, answered, elapsed, newSession, pause, resume,
  loadSession, storeSession, dropSession, optionList
} from '../lib/tests.js';

const modeName = m => (m === 'learn' ? 'Öyrənmə rejimi' : 'İmtahan rejimi');

/**
 * type: 'lesson' | 'exam'; id; name; tests: { count, updatedAt }; limitMin; user
 */
export default function TestPanel({ type, id, name, tests, limitMin = 0, user, onBack, backLabel }) {
  const { toast, confirm } = useUi();
  const key = `${type}:${id}`;
  const uname = user?.username;
  const stamp = tests?.updatedAt || '';
  const [s, setS] = useState(() => {
    const saved = loadSession(uname, key);
    if (saved && saved.stamp !== stamp) { dropSession(uname, key); return null; }
    return saved ? { ...pause(saved), autoResume: false } : null;
  });
  const [mode, setMode] = useState(type === 'exam' ? 'exam' : 'learn');
  const [loading, setLoading] = useState(false);
  const [, tick] = useState(0);
  const top = useRef(null);

  // keep the session in this browser (always saved as paused, so time spent
  // with the page closed is not counted); pause when leaving or hiding the tab
  const latest = useRef(s);
  latest.current = s;
  useEffect(() => { if (s) storeSession(uname, pause(s)); }, [s, uname]);
  useEffect(() => () => { if (latest.current) storeSession(uname, pause(latest.current)); }, [uname]);
  useEffect(() => {
    const v = () => {
      if (document.visibilityState === 'hidden') {
        setS(cur => (cur?.stage === 'running' && cur.runningSince ? { ...pause(cur), autoResume: true } : cur));
      } else {
        setS(cur => (cur?.autoResume ? { ...resume(cur), autoResume: false } : cur));
      }
    };
    document.addEventListener('visibilitychange', v);
    return () => document.removeEventListener('visibilitychange', v);
  }, []);
  useEffect(() => {
    if (s?.stage !== 'running' || !s.runningSince) return;
    let n = 0;
    const t = setInterval(() => {
      tick(x => x + 1);
      if (++n % 5 === 0 && latest.current) storeSession(uname, pause(latest.current));
    }, 1000);
    return () => clearInterval(t);
  }, [s?.stage, s?.runningSince, uname]);

  const scrollTop = () => top.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });

  async function start(forceMode, subset) {
    setLoading(true);
    try {
      let questions = subset;
      if (!questions) {
        const bank = await api.tests(id);
        questions = Array.isArray(bank?.questions) ? bank.questions : [];
      }
      if (!questions.length) throw new Error('Bu paketdə işlənə bilən sual yoxdur.');
      setS(newSession({ key, type, id, name, mode: forceMode || mode, questions, stamp, limitMin, subset: !!subset }));
      scrollTop();
    } catch (e) { toast(`Test açılmadı: ${e.message}`, 'error'); }
    finally { setLoading(false); }
  }

  async function restart() {
    if (s?.stage === 'running' && !await confirm({ title: 'Test yenidən başlasın?', text: 'Bu cəhdin bütün cavabları və işarələri silinəcək.', confirmLabel: 'Yenidən başla', danger: true })) return;
    const m = s?.mode || mode;
    dropSession(uname, key); setS(null);
    await start(m);
  }

  async function finish() {
    const blank = s.questions.length - answered(s);
    const ok = await confirm({
      title: 'Test yekunlaşdırılsın?',
      text: `${blank ? `${blank} sual cavabsız qalıb. ` : ''}Yekunlaşdırdıqdan sonra cavabları dəyişmək olmayacaq.`,
      confirmLabel: 'Testi yekunlaşdır'
    });
    if (!ok) return;
    setS(cur => ({ ...pause(cur), stage: 'result', filter: 'all', finishedAt: new Date().toISOString() }));
    scrollTop();
  }

  async function retryWrong() {
    const r = results(s);
    const wrong = s.questions.filter((_, i) => r.states[i] === 'wrong');
    if (!wrong.length) { toast('Səhv cavab yoxdur.'); return; }
    await start('learn', wrong);
  }

  const update = (fn) => setS(cur => fn({ ...cur }));
  const setAnswer = (i, k, on) => update(c => {
    const q = c.questions[i];
    if (!q || c.checked[i] || problemOf(q)) return c;
    let a = [...(c.answers[i] || [])];
    if (q.type === 'single') a = [k];
    else if (on) { if (!a.includes(k)) a.push(k); } else a = a.filter(x => x !== k);
    return { ...c, answers: { ...c.answers, [i]: a }, focus: i };
  });

  /* ---------- views ---------- */
  if (!tests) {
    return (
      <div className="ga-card ga-empty">
        <ListChecks size={26} />
        <strong>Test bankı hələ əlavə edilməyib</strong>
        <span>Word test faylını əlavə etdikdən sonra suallar burada interaktiv işlənir.</span>
      </div>
    );
  }

  if (!s) {
    return (
      <div className="ga-card intro" ref={top}>
        <div className="intro-head">
          <span className="intro-icon">{type === 'exam' ? <GraduationCap size={22} /> : <BookOpenCheck size={22} />}</span>
          <div>
            <h2>{name}</h2>
            <p>{type === 'exam' ? 'Hazır test bankı üzrə yekun sınaq.' : 'Suallar Word test bankından hazırlanıb. Cavab variantları qarışdırılmır.'}</p>
          </div>
        </div>
        <div className="intro-meta">
          <span className="meta-chip"><ListChecks size={13} />{tests.count} sual</span>
          {limitMin > 0 && <span className="meta-chip"><Clock3 size={13} />{limitMin} dəqiqə</span>}
          <span className="meta-chip">{Math.ceil(tests.count / PAGE_SIZE)} səhifə</span>
        </div>
        {type === 'exam' ? (
          <div className="note-box soft">İmtahan rejimində düzgün cavablar yalnız yekunda açılır. Vaxt bitsə də cavablandırmaya davam etmək olar.</div>
        ) : (
          <div className="mode-grid">
            <button className={`mode-card ${mode === 'learn' ? 'on' : ''}`} onClick={() => setMode('learn')}>
              <BookOpenCheck size={20} />
              <strong>Öyrənmə rejimi</strong>
              <span>Hər sualın cavabını yoxlayın, düzgün variantı, izahı və hüquqi istinadı dərhal görün.</span>
            </button>
            <button className={`mode-card ${mode === 'exam' ? 'on' : ''}`} onClick={() => setMode('exam')}>
              <GraduationCap size={20} />
              <strong>İmtahan rejimi</strong>
              <span>Bütün sualları cavablandırın, nəticə və təhlil yalnız sonda açılır.</span>
            </button>
          </div>
        )}
        <div className="intro-actions">
          <button className="btn primary big" onClick={() => start()} disabled={loading}>
            {loading ? <Loader2 size={16} className="spin" /> : <Play size={16} />}Testə başla
          </button>
          <span className="field-note">Cavablarınız bu brauzerdə saxlanılır: səhifədən çıxsanız da qaldığınız yerdən davam edə bilərsiniz.</span>
        </div>
      </div>
    );
  }

  if (s.stage === 'running' && !s.runningSince) {
    return (
      <div className="ga-card intro" ref={top}>
        <div className="intro-head">
          <span className="intro-icon warn"><Clock3 size={22} /></span>
          <div>
            <h2>Yarımçıq test</h2>
            <p>{s.name} · {modeName(s.mode)}{s.subset ? ' · səhv cavablar' : ''}</p>
          </div>
        </div>
        <div className="intro-meta">
          <span className="meta-chip">Cavablandırılıb <b>{answered(s)} / {s.questions.length}</b></span>
          <span className="meta-chip"><Clock3 size={13} />{niceTime(elapsed(s))}</span>
          {s.marked.length > 0 && <span className="meta-chip"><Flag size={13} />{s.marked.length} işarəli</span>}
        </div>
        <div className="intro-actions">
          <button className="btn primary big" onClick={() => setS(resume(s))}><Play size={16} />Davam et</button>
          <button className="btn" onClick={restart}><RotateCcw size={15} />Yenidən başla</button>
        </div>
      </div>
    );
  }

  if (s.stage === 'result') return <Results s={s} setS={setS} top={top} restart={restart} retryWrong={retryWrong} onBack={onBack} backLabel={backLabel} />;

  /* ---------- running ---------- */
  const n = s.questions.length;
  const pages = Math.ceil(n / PAGE_SIZE);
  const begin = s.page * PAGE_SIZE;
  const end = Math.min(begin + PAGE_SIZE, n);
  const done = answered(s);
  const secs = elapsed(s);
  const over = s.limit && secs >= s.limit;

  const jump = (i) => {
    setS(c => ({ ...c, focus: i, page: Math.floor(i / PAGE_SIZE) }));
    setTimeout(() => document.querySelector(`[data-q="${i}"]`)?.scrollIntoView({ block: 'center', behavior: 'smooth' }), 30);
  };
  const turn = (d) => { setS(c => ({ ...c, page: Math.max(0, Math.min(pages - 1, c.page + d)), focus: Math.max(0, Math.min(pages - 1, c.page + d)) * PAGE_SIZE })); scrollTop(); };

  return (
    <div className="test-wrap" ref={top}>
      <div className="test-head">
        <span className="test-mode">{modeName(s.mode)}{s.subset ? ' · səhvlər' : ''}</span>
        <span className={`test-stat ${over ? 'over' : ''}`}><Clock3 size={14} /><b>{niceTime(secs)}</b>{s.limit ? <> / {niceTime(s.limit)}</> : null}</span>
        <span className="test-stat"><CheckCircle2 size={14} />Cavablandırılıb <b>{done}</b></span>
        <span className="test-stat"><Circle size={14} />Cavabsız <b>{n - done}</b></span>
        <span className="test-progress"><span style={{ width: `${(done / n) * 100}%` }} /></span>
      </div>
      {over ? <div className="note-box warn">Planlaşdırılmış vaxt bitib. Testi dayandırmadan davam etdirə bilərsiniz.</div> : null}

      <div className="test-layout">
        <div className="q-stack">
          {s.questions.slice(begin, end).map((q, k) => (
            <Question key={begin + k} s={s} q={q} i={begin + k}
              onAnswer={setAnswer}
              onMark={i => update(c => ({ ...c, focus: i, marked: c.marked.includes(i) ? c.marked.filter(x => x !== i) : [...c.marked, i] }))}
              onClear={i => update(c => (c.checked[i] ? c : { ...c, focus: i, answers: { ...c.answers, [i]: [] } }))}
              onCheck={i => {
                if (!(s.answers[i] || []).length) { toast('Əvvəlcə cavab variantını seçin.'); return; }
                update(c => ({ ...c, focus: i, checked: { ...c.checked, [i]: true } }));
              }} />
          ))}
          <div className="page-bar">
            <button className="btn small" onClick={() => turn(-1)} disabled={s.page === 0}><ChevronLeft size={15} />Əvvəlki</button>
            <span>Səhifə {s.page + 1} / {pages} · Sual {begin + 1}–{end}</span>
            {s.page < pages - 1
              ? <button className="btn small" onClick={() => turn(1)}>Növbəti<ChevronRight size={15} /></button>
              : <button className="btn primary small" onClick={finish}>Yekunlaşdır</button>}
          </div>
        </div>

        <aside className="ga-card test-side">
          <div className="side-title">Suallar</div>
          <div className="num-grid">
            {s.questions.map((q, i) => {
              const a = (s.answers[i] || []).length > 0;
              const checked = s.checked[i];
              const cls = [
                a ? 'answered' : '', s.marked.includes(i) ? 'marked' : '', s.focus === i ? 'focus' : '',
                checked ? (isRight(q, s.answers[i]) ? 'right' : 'wrong') : '', problemOf(q) ? 'blocked' : ''
              ].join(' ');
              return <button key={i} className={`num-btn ${cls}`} title={`Sual ${i + 1}`} onClick={() => jump(i)}>{i + 1}</button>;
            })}
          </div>
          <div className="legend">
            <span><i className="answered" />Cavablandırılıb</span>
            <span><i className="marked" />Sonra qayıtmaq üçün işarəli</span>
            <span><i />Cavabsız</span>
          </div>
          <button className="btn primary full" onClick={finish}>Testi yekunlaşdır</button>
          <button className="btn full ghost-btn" onClick={restart}><RotateCcw size={14} />Yenidən başla</button>
        </aside>
      </div>
    </div>
  );
}

function Question({ s, q, i, onAnswer, onMark, onClear, onCheck }) {
  const problem = problemOf(q);
  const checked = !!s.checked[i];
  const sel = s.answers[i] || [];
  const multi = q.type === 'multiple';
  const right = checked && isRight(q, sel);
  return (
    <article className={`ga-card q-card ${s.focus === i ? 'focus' : ''}`} data-q={i}>
      <div className="q-top">
        <span className="q-num">Sual {i + 1}</span>
        {q.topic && <span className="q-topic">{q.topic}</span>}
        <span className="q-kind">{problem ? 'Oxunmayan sual' : multi ? 'Bir neçə düzgün cavab' : 'Bir düzgün cavab'}</span>
        {s.marked.includes(i) && <span className="q-flag"><Flag size={13} /></span>}
      </div>
      <div className="q-text">{q.text || q.question || 'Sualın mətni oxunmur'}</div>
      {problem ? (
        <div className="note-box warn">Bu sual işlənə bilmir: {problem}. Proqram cavabı təxmin etmir.</div>
      ) : (
        <div className="options">
          {optionList(q).map(o => {
            const on = sel.includes(o.key);
            const good = checked && q.correct_answers.includes(o.key);
            const bad = checked && on && !good;
            return (
              <label key={o.key} className={`option ${on ? 'on' : ''} ${good ? 'good' : ''} ${bad ? 'bad' : ''} ${checked ? 'locked' : ''}`}>
                <input type={multi ? 'checkbox' : 'radio'} name={`q-${i}`} checked={on} disabled={checked}
                  onChange={e => onAnswer(i, o.key, e.target.checked)} />
                <span className="opt-key">{o.key}</span>
                <span className="opt-text">{o.text}</span>
              </label>
            );
          })}
        </div>
      )}
      <div className="q-actions">
        <button className="btn small" onClick={() => onMark(i)}>
          {s.marked.includes(i) ? <><FlagOff size={14} />İşarəni götür</> : <><Flag size={14} />İşarələ, sonra qayıt</>}
        </button>
        <button className="btn small" onClick={() => onClear(i)} disabled={checked || !!problem || !sel.length}><Eraser size={14} />Cavabı sil</button>
        <span className="spacer" />
        {s.mode === 'learn' && !problem && !checked && (
          <button className="btn small soft" onClick={() => onCheck(i)}><Target size={14} />Cavabı yoxla</button>
        )}
      </div>
      {checked && (
        <div className={`feedback ${right ? 'good' : 'bad'}`}>
          <strong>{right ? <><CheckCircle2 size={15} />Düzgün cavab</> : <><XCircle size={15} />Yanlış cavab</>}</strong>
          <div>Düzgün variant: <b>{q.correct_answers.join(', ')}</b></div>
          {q.explanation && <div>{q.explanation}</div>}
          {q.reference && <div><b>Hüquqi istinad:</b> {q.reference}</div>}
        </div>
      )}
    </article>
  );
}

function Results({ s, setS, top, restart, retryWrong, onBack, backLabel }) {
  const r = results(s);
  let rows = s.questions.map((q, i) => ({ q, i, st: r.states[i] }));
  if (s.filter === 'wrong') rows = rows.filter(x => x.st === 'wrong');
  if (s.filter === 'blank') rows = rows.filter(x => x.st === 'blank');
  const deg = Math.round((r.pct / 100) * 360);
  return (
    <div className="test-wrap" ref={top}>
      <div className="ga-card result-hero">
        <div>
          <div className="result-kicker">Test yekunlaşdı</div>
          <h2>Nəticəniz hazırdır</h2>
          <p>{s.name} · {modeName(s.mode)}{s.subset ? ' · səhvlər' : ''}</p>
          <div className="result-actions">
            <button className="btn primary small" onClick={restart}><RotateCcw size={14} />Yenidən başla</button>
            <button className="btn small" onClick={retryWrong} disabled={!r.wrong}>Səhvləri yenidən işlə</button>
            {onBack && <button className="btn small" onClick={onBack}>{backLabel || 'Geri'}</button>}
          </div>
        </div>
        <div className="score" style={{ '--deg': `${deg}deg` }}><span>{r.pct}%</span></div>
      </div>
      <div className="metrics">
        <div className="metric"><span>Ümumi sual</span><b>{s.questions.length}</b></div>
        <div className="metric good"><span>Düzgün</span><b>{r.right}</b></div>
        <div className="metric bad"><span>Səhv</span><b>{r.wrong}</b></div>
        <div className="metric"><span>Cavabsız</span><b>{r.blank}</b></div>
        <div className="metric"><span>Sərf edilən vaxt</span><b>{niceTime(elapsed(s))}</b></div>
      </div>
      <div className="review-head">
        <h3>Cavabların təhlili</h3>
        <div className="seg small">
          {[['all', 'Hamısı'], ['wrong', 'Yalnız səhvlər'], ['blank', 'Cavabsızlar']].map(([k, v]) => (
            <button key={k} className={s.filter === k ? 'on' : ''} onClick={() => setS(c => ({ ...c, filter: k }))}>{v}</button>
          ))}
        </div>
      </div>
      {rows.length ? rows.map(({ q, i, st }) => (
        <div key={i} className={`ga-card review ${st}`}>
          <span className={`review-badge ${st}`}>{st === 'right' ? 'Düzgün' : st === 'blank' ? 'Cavabsız' : 'Səhv'}</span>
          <h4>{i + 1}. {q.text || q.question || 'Oxunmayan sual'}</h4>
          <div className="review-opts">
            {optionList(q).map(o => {
              const mine = (s.answers[i] || []).includes(o.key);
              const good = (q.correct_answers || []).includes(o.key);
              return (
                <div key={o.key} className={`review-opt ${good ? 'good' : ''} ${mine && !good ? 'bad' : ''}`}>
                  <span className="opt-key">{o.key}</span><span>{o.text}</span>
                  {mine && <em>seçiminiz</em>}
                </div>
              );
            })}
          </div>
          {q.explanation && <div className="review-note"><b>İzah:</b> {q.explanation}</div>}
          {q.reference && <div className="review-note"><b>Hüquqi istinad:</b> {q.reference}</div>}
          {problemOf(q) && <div className="review-note">Texniki məhdudiyyət: {problemOf(q)}</div>}
        </div>
      )) : <div className="ga-card ga-empty small">Bu filtr üzrə sual yoxdur.</div>}
    </div>
  );
}

