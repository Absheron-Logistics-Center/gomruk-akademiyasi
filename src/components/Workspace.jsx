// Workspace.jsx — the frame of every page: the brand and the lesson list on
// the left, a slim top bar (where you are, Orijinal / İzah / Test, account)
// and the page itself on the right. On a phone the list opens from the menu button.
import { useEffect, useMemo, useRef, useState } from 'react';
import { Search, Plus, FolderUp, Pencil, Trash2, X, Menu, LogOut, ChevronLeft, ChevronRight, BookOpen } from 'lucide-react';
import AddDialog from './AddDialog.jsx';
import FolderImport from './FolderImport.jsx';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { go } from '../lib/nav.js';
import { dropSession } from '../lib/tests.js';

const lower = s => String(s || '').toLocaleLowerCase('az');
export const SUBS = [
  { tab: 'original', label: 'Orijinal', count: l => (l.originals || []).length },
  { tab: 'izah', label: 'İzah', count: l => (l.explanation ? 1 : 0) },
  { tab: 'test', label: 'Test', count: l => l.tests?.count || 0 }
];
const initials = (name) => String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toLocaleUpperCase('az') || '?';

// active: { type: 'home'|'lesson'|'exam', id, tab }
// kicker / title: where you are; seg: the switch in the top bar;
// nav: { prev, next } links; fill: the page fills the screen (the document viewer)
export default function Workspace({ active, kicker, title, seg, nav, fill, children, ...props }) {
  const { catalog, reload, user, logout } = props;
  const { toast, confirm, prompt } = useUi();
  const [query, setQuery] = useState('');
  const [drawer, setDrawer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [order, setOrder] = useState(null);
  const [menu, setMenu] = useState(false);
  const listRef = useRef(null);

  useEffect(() => { setDrawer(false); }, [active?.type, active?.id, active?.tab]);

  // keep the open lesson in sight in the list
  useEffect(() => {
    const box = listRef.current, row = box?.querySelector('.nav-row.on');
    if (!box || !row) return;
    const r = row.getBoundingClientRect(), b = box.getBoundingClientRect();
    if (r.top < b.top || r.bottom > b.bottom) box.scrollTop += r.top - b.top - b.height / 3;
  }, [active?.id, catalog]);

  useEffect(() => {
    if (!menu) return;
    const off = (e) => { if (!e.target.closest?.('.acct')) setMenu(false); };
    document.addEventListener('pointerdown', off);
    return () => document.removeEventListener('pointerdown', off);
  }, [menu]);

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
  const exams = catalog?.exams || [];

  async function rename(l) {
    const t = await prompt({ title: 'Dərsin adını dəyiş', label: 'Dərsin adı', value: l.title });
    if (!t || t === l.title) return;
    try { await api.renameLesson(l.id, t); await reload(); toast('Dərsin adı dəyişdirildi.'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function remove(l) {
    const ok = await confirm({
      title: `Dərs ${l.number} silinsin?`, danger: true, confirmLabel: 'Dərsi sil',
      text: `"${l.title}" və onun bütün sənədləri, izahı və testləri silinəcək. Silinmə hamı üçündür və geri qaytarılmır.`
    });
    if (!ok) return;
    try {
      await api.deleteLesson(l.id);
      dropSession(user?.username, `lesson:${l.id}`);
      await reload();
      toast('Dərs silindi.');
      if (active?.type === 'lesson' && active.id === l.id) {
        const next = lessons.find(x => x.id !== l.id);
        go(next ? `/ders/${next.id}` : '/');
      }
    } catch (e) { toast(e.message, 'error'); }
  }
  async function addExam() {
    const t = await prompt({ title: 'Yeni yekun sınaq', label: 'Sınağın adı', value: `Yekun sınaq ${exams.length + 1}`, confirmLabel: 'Əlavə et' });
    if (!t) return;
    try { const ex = await api.addExam(t); await reload(); toast(`"${t}" əlavə edildi.`); go(`/sinaq/${ex.id}`); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function renameExam(ex) {
    const t = await prompt({ title: 'Sınağın adını dəyiş', label: 'Ad', value: ex.title });
    if (!t || t === ex.title) return;
    try { await api.saveExam(ex.id, { title: t }); await reload(); toast('Ad dəyişdirildi.'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function removeExam(ex) {
    const ok = await confirm({
      title: `"${ex.title}" silinsin?`, danger: true, confirmLabel: 'Sınağı sil',
      text: `${ex.tests ? 'Bu sınaq və onun test bankı' : 'Bu sınaq'} silinəcək. Silinmə hamı üçündür və geri qaytarılmır.`
    });
    if (!ok) return;
    try {
      await api.deleteExam(ex.id);
      dropSession(user?.username, `exam:${ex.id}`);
      await reload();
      toast('Sınaq silindi.');
      if (active?.type === 'exam' && active.id === ex.id) go('/');
    } catch (e) { toast(e.message, 'error'); }
  }

  /* drag a lesson to a new place */
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
    ids.splice(ids.indexOf(d.over) + (d.after ? 1 : 0), 0, d.id);
    setOrder(ids);
    try { await api.reorder(ids); await reload(); toast('Yeni sıra yadda saxlanıldı.'); }
    catch (err) { toast(`Sıra saxlanılmadı: ${err.message}`, 'error'); }
    finally { setOrder(null); }
  }

  return (
    <div className="shell">
      <button className="brand" onClick={() => go('/')} title="Birinci dərs">
        <span className="brand-mark"><BookOpen size={16} strokeWidth={2.2} /></span>
        <span>Gömrük Akademiyası</span>
      </button>

      <header className="bar">
        <button className="bar-menu" onClick={() => setDrawer(true)} aria-label="Dərslərin siyahısı"><Menu size={19} /></button>
        <div className="bar-where">
          {kicker && <span className="bar-kicker">{kicker}</span>}
          <h1 title={title}>{title}</h1>
          {nav && (
            <span className="bar-nav">
              <button disabled={!nav.prev} onClick={() => nav.prev && go(nav.prev)} title="Əvvəlki"><ChevronLeft size={16} /></button>
              <button disabled={!nav.next} onClick={() => nav.next && go(nav.next)} title="Növbəti"><ChevronRight size={16} /></button>
            </span>
          )}
        </div>
        {seg && <div className="bar-seg">{seg}</div>}
        <div className="acct">
          <button className="avatar" onClick={() => setMenu(m => !m)} title={user?.name} aria-expanded={menu}>{initials(user?.name)}</button>
          {menu && (
            <div className="acct-menu">
              <div className="acct-name"><span className="avatar sm">{initials(user?.name)}</span><span>{user?.name}</span></div>
              <button onClick={() => { setMenu(false); logout(); }}><LogOut size={15} />Çıxış</button>
            </div>
          )}
        </div>
      </header>

      {drawer && <div className="side-scrim" onClick={() => setDrawer(false)} />}
      <aside className={`side ${drawer ? 'show' : ''}`} aria-label="Dərslər">
        <div className="side-head">
          <span className="side-brand"><span className="brand-mark"><BookOpen size={15} strokeWidth={2.2} /></span>Gömrük Akademiyası</span>
          <button className="side-close" onClick={() => setDrawer(false)} aria-label="Bağla"><X size={17} /></button>
        </div>
        <div className="side-tools">
          <label className="side-search">
            <Search size={15} />
            <input value={query} placeholder="Dərs axtar" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
            {query && <button onClick={() => setQuery('')} aria-label="Təmizlə"><X size={13} /></button>}
          </label>
          <button className="side-btn" onClick={() => setFolderOpen(true)} title="Qovluqdan yüklə"><FolderUp size={16} /></button>
          <button className="side-btn primary" onClick={() => setAdding(true)} title="Dərs əlavə et"><Plus size={17} /></button>
        </div>

        <div className="side-scroll" ref={listRef}>
          <div className="nav-group"><span>Dərslər</span><em>{lessons.length}</em></div>
          <div onDragOver={e => drag && e.preventDefault()} onDrop={onDrop}>
            {visible.map(l => {
              const on = active?.type === 'lesson' && active.id === l.id;
              const mark = drag?.over === l.id && drag.id !== l.id ? (drag.after ? 'drop-after' : 'drop-before') : '';
              return (
                <div key={l.id} className={`nav-item ${drag?.id === l.id ? 'dragging' : ''} ${mark}`}
                  draggable onDragStart={e => onDragStart(e, l.id)} onDragOver={e => onDragOver(e, l.id)} onDragEnd={() => setDrag(null)}>
                  <div className={`nav-row ${on ? 'on' : ''}`}>
                    <button className="nav-open" onClick={() => go(`/ders/${l.id}`)} title={l.title}>
                      <span className="nav-num">{l.number}</span>
                      <span className="nav-name">{l.title}</span>
                    </button>
                    <span className="nav-tools">
                      <button title="Adını dəyiş" onClick={() => rename(l)}><Pencil size={13} /></button>
                      <button className="danger" title={`Dərs ${l.number}-i sil`} onClick={() => remove(l)}><Trash2 size={13} /></button>
                    </span>
                  </div>
                </div>
              );
            })}
            {!visible.length && <div className="nav-none">{query ? 'Axtarışa uyğun dərs yoxdur.' : 'Hələ dərs yoxdur.'}</div>}
          </div>

          <div className="nav-group"><span>Yekun sınaqlar</span><em>{exams.length}</em>
            <button onClick={addExam} title="Yeni yekun sınaq"><Plus size={14} /></button>
          </div>
          {exams.map((ex, i) => {
            const on = active?.type === 'exam' && active.id === ex.id;
            return (
              <div key={ex.id} className="nav-item">
                <div className={`nav-row ${on ? 'on' : ''} ${ex.tests ? '' : 'muted'}`}>
                  <button className="nav-open" onClick={() => go(`/sinaq/${ex.id}`)} title={ex.title}>
                    <span className="nav-num">{i + 1}</span>
                    <span className="nav-name">{ex.title}</span>
                    {ex.tests && <em className="nav-meta">{ex.tests.count}</em>}
                  </button>
                  <span className="nav-tools">
                    <button title="Adını dəyiş" onClick={() => renameExam(ex)}><Pencil size={13} /></button>
                    <button className="danger" title="Sınağı sil" onClick={() => removeExam(ex)}><Trash2 size={13} /></button>
                  </span>
                </div>
              </div>
            );
          })}
          {!exams.length && <button className="nav-none link" onClick={addExam}>Yekun sınaq əlavə et</button>}
        </div>
      </aside>

      <main className={`main ${fill ? 'fill' : ''}`}>
        {seg && <div className="seg-row">{seg}</div>}
        {children}
      </main>

      {adding && <AddDialog kind="lesson" catalog={catalog} onClose={() => setAdding(false)}
        onDone={async (res) => { setAdding(false); await reload(); if (res?.go) go(res.go); }} />}
      {folderOpen && <FolderImport catalog={catalog} onClose={() => setFolderOpen(false)} onDone={async () => { await reload(); }} />}
    </div>
  );
}

// the Orijinal / İzah / Test switch
export function Seg({ items, value, onChange }) {
  return (
    <div className="sw" role="tablist">
      {items.map(it => (
        <button key={it.key} role="tab" aria-selected={value === it.key} className={value === it.key ? 'on' : ''} onClick={() => onChange(it.key)}>
          {it.label}{it.count !== undefined && <span className="sw-n">{it.count}</span>}
        </button>
      ))}
    </div>
  );
}
