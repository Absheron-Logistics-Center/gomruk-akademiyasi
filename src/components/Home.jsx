import { useMemo, useRef, useState } from 'react';
import {
  Search, Plus, FolderUp, GripVertical, Pencil, Trash2, FileText, BookOpen, ListChecks,
  ChevronRight, Loader2, PlayCircle, Library
} from 'lucide-react';
import Topbar from './Topbar.jsx';
import AddDialog from './AddDialog.jsx';
import FolderImport from './FolderImport.jsx';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { go } from '../lib/nav.js';
import { runningSessions, answered, dropSession } from '../lib/tests.js';
import Logo from '../assets/header-logo.svg';

const lower = s => String(s || '').toLocaleLowerCase('az');

export default function Home(props) {
  const { catalog, reload, user, loadError } = props;
  const { toast, confirm, prompt } = useUi();
  const [query, setQuery] = useState('');
  const [adding, setAdding] = useState(null);       // null | { kind }
  const [folderOpen, setFolderOpen] = useState(false);
  const [drag, setDrag] = useState(null);           // { id, over, after }
  const [order, setOrder] = useState(null);         // optimistic order while saving
  const listRef = useRef(null);

  const lessons = useMemo(() => {
    const all = (catalog?.lessons || []).map((l, i) => ({ ...l, number: i + 1 }));
    if (!order) return all;
    const pos = new Map(order.map((id, i) => [id, i]));
    return [...all].sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9)).map((l, i) => ({ ...l, number: i + 1 }));
  }, [catalog, order]);

  const visible = useMemo(() => {
    const q = lower(query.trim());
    if (!q) return lessons;
    return lessons.filter(l => [l.title, `dərs ${l.number}`, String(l.number), ...(l.originals || []).map(d => d.name)].some(x => lower(x).includes(q)));
  }, [lessons, query]);

  const running = useMemo(() => runningSessions(user?.username).filter(s => {
    if (s.type === 'lesson') return catalog?.lessons?.some(l => l.id === s.id);
    return catalog?.exams?.some(e => e.id === s.id && e.tests);
  }), [catalog, user]);

  async function rename(l) {
    const title = await prompt({ title: 'Dərsin adını dəyiş', label: 'Dərsin adı', value: l.title });
    if (!title || title === l.title) return;
    try { await api.renameLesson(l.id, title); await reload(); toast('Dərsin adı dəyişdirildi.'); }
    catch (e) { toast(e.message, 'error'); }
  }

  async function remove(l) {
    const ok = await confirm({
      title: 'Dərs silinsin?',
      text: `"${l.title}" və onun bütün sənədləri, izahı və testləri silinəcək. Silinmə hamı üçündür və geri qaytarılmır.`,
      confirmLabel: 'Dərsi sil', danger: true
    });
    if (!ok) return;
    try {
      await api.deleteLesson(l.id);
      dropSession(user?.username, `lesson:${l.id}`);
      await reload();
      toast('Dərs silindi.');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* ---------- drag to reorder ---------- */
  function onDragStart(e, id) {
    if (query.trim()) { e.preventDefault(); toast('Sıranı dəyişmək üçün əvvəlcə axtarışı təmizləyin.'); return; }
    setDrag({ id, over: null, after: false });
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', id);
  }
  function onDragOver(e, id) {
    if (!drag) return;
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    const after = e.clientY > r.top + r.height / 2;
    if (drag.over !== id || drag.after !== after) setDrag(d => ({ ...d, over: id, after }));
  }
  async function onDrop(e) {
    e.preventDefault();
    const d = drag; setDrag(null);
    if (!d || !d.over || d.over === d.id) return;
    const ids = lessons.map(l => l.id).filter(x => x !== d.id);
    const at = ids.indexOf(d.over) + (d.after ? 1 : 0);
    ids.splice(at, 0, d.id);
    setOrder(ids);
    try { await api.reorder(ids); await reload(); toast('Yeni sıra yadda saxlanıldı. Nömrələr yeniləndi.'); }
    catch (err) { toast(`Sıra saxlanılmadı: ${err.message}`, 'error'); }
    finally { setOrder(null); }
  }

  return (
    <>
      <Topbar {...props} />
      <div className="home-wrap ga-home">
        <img className="ga-logo" src={Logo} alt="Abşeron Logistika Mərkəzi" />
        <h2 className="home-title">GÖMRÜK AKADEMİYASI</h2>
        <p className="ga-lead">Normativ aktlar, izahlı tədris materialları və testlər bir yerdə. Əlavə etdiyiniz hər şey bütün işçilər üçün görünür.</p>

        {running.length > 0 && (
          <div className="resume-strip">
            {running.slice(0, 3).map(s => (
              <button key={s.key} className="resume-item" onClick={() => go(s.type === 'lesson' ? `/ders/${s.id}/test` : `/sinaq/${s.id}`)}>
                <PlayCircle size={18} />
                <span className="resume-text">
                  <strong>Yarımçıq test: {s.name}</strong>
                  <span>{answered(s)} / {s.questions.length} sual cavablandırılıb</span>
                </span>
                <span className="resume-go">Davam et<ChevronRight size={15} /></span>
              </button>
            ))}
          </div>
        )}

        <div className="search-wrap">
          <input type="text" placeholder="Dərsin adı, nömrəsi və ya sənəd adı ilə axtar" value={query} onChange={e => setQuery(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
          <span className="search-icon"><Search size={17} /></span>
        </div>

        <div className="home-actions">
          <button className="btn primary" onClick={() => setAdding({ kind: 'lesson' })}><Plus size={16} />Dərs əlavə et</button>
          <button className="btn" onClick={() => setFolderOpen(true)}><FolderUp size={16} />Qovluqdan yüklə</button>
        </div>

        {!catalog && !loadError && <div className="empty-state"><Loader2 size={18} className="spin" />Dərslər yüklənir</div>}
        {!catalog && loadError && (
          <div className="empty-state error">
            {loadError}
            <button className="btn small" onClick={reload}>Yenidən yoxla</button>
          </div>
        )}

        {catalog && (
          <div className="ga-groups">
            <section className="group-card open">
              <div className="group-head static">
                <span className="group-folder"><Library size={18} /></span>
                <span className="group-name">Dərslər</span>
                <span className="group-count">{lessons.length}</span>
              </div>
              <div className="group-body" ref={listRef} onDragOver={e => drag && e.preventDefault()} onDrop={onDrop}>
                {visible.map(l => (
                  <LessonRow key={l.id} l={l}
                    dragging={drag?.id === l.id}
                    dropMark={drag?.over === l.id && drag.id !== l.id ? (drag.after ? 'after' : 'before') : ''}
                    onDragStart={e => onDragStart(e, l.id)}
                    onDragOver={e => onDragOver(e, l.id)}
                    onDragEnd={() => setDrag(null)}
                    onOpen={() => go(`/ders/${l.id}`)}
                    onRename={() => rename(l)}
                    onDelete={() => remove(l)} />
                ))}
                {!visible.length && lessons.length > 0 && <div className="empty-state">Axtarışa uyğun dərs yoxdur.</div>}
                {!lessons.length && (
                  <div className="ga-empty">
                    <BookOpen size={26} />
                    <strong>Hələ dərs yoxdur</strong>
                    <span>Normativ aktı, izahlı materialı və Word test bankını seçərək ilk dərsi yaradın, və ya DERSLER qovluğunu bir dəfəyə yükləyin.</span>
                  </div>
                )}
                {!query.trim() && (
                  <button className="process-item create-btn" onClick={() => setAdding({ kind: 'lesson' })}>
                    <span className="num"><Plus size={16} /></span>
                    <span className="label">Yeni dərs əlavə et</span>
                  </button>
                )}
              </div>
            </section>

          </div>
        )}
      </div>

      {adding && <AddDialog kind={adding.kind} catalog={catalog} onClose={() => setAdding(null)}
        onDone={async (res) => { setAdding(null); await reload(); if (res?.go) go(res.go); }} />}
      {folderOpen && <FolderImport catalog={catalog} onClose={() => setFolderOpen(false)} onDone={async () => { await reload(); }} />}
    </>
  );
}

function LessonRow({ l, dragging, dropMark, onDragStart, onDragOver, onDragEnd, onOpen, onRename, onDelete }) {
  const n = (l.originals || []).length;
  return (
    <div className={`lesson-row ${dragging ? 'dragging' : ''} ${dropMark ? `drop-${dropMark}` : ''}`}
      draggable onDragStart={onDragStart} onDragOver={onDragOver} onDragEnd={onDragEnd}>
      <div className="process-item" role="button" tabIndex={0} onClick={onOpen}
        onKeyDown={e => { if (e.key === 'Enter') onOpen(); }}>
        <span className="order-grip" title="Sürüşdürərək yerini dəyişin" onClick={e => e.stopPropagation()}><GripVertical size={16} /></span>
        <span className="num">{l.number}</span>
        <span className="label">
          {l.title}
          <span className="row-meta">
            {n > 0 && <span className="meta-chip"><FileText size={13} />{n === 1 ? 'Normativ akt' : `${n} normativ akt`}</span>}
            {l.explanation && <span className="meta-chip"><BookOpen size={13} />İzah</span>}
            {l.tests && <span className="meta-chip"><ListChecks size={13} />{l.tests.count} sual</span>}
            {!n && !l.explanation && !l.tests && <span className="meta-chip muted">Material əlavə edilməyib</span>}
          </span>
        </span>
        <span className="row-actions" onClick={e => e.stopPropagation()}>
          <button className="group-act-btn" title="Adını dəyiş" onClick={onRename}><Pencil size={14} /></button>
          <button className="group-act-btn danger" title="Dərsi sil" onClick={onDelete}><Trash2 size={14} /></button>
        </span>
      </div>
    </div>
  );
}
