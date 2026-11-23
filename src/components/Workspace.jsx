// Workspace.jsx — the layout of an open lesson or exam: the list of lessons
// moves to the left side, the open lesson fills the right side (like V1.5).
// On a phone the list opens from the menu button in the top bar.
import { useEffect, useMemo, useState } from 'react';
import { Search, Plus, FolderUp, Pencil, Trash2, ChevronRight, FileText, BookOpen, ListChecks, X, Home as HomeIcon } from 'lucide-react';
import Topbar from './Topbar.jsx';
import AddDialog from './AddDialog.jsx';
import FolderImport from './FolderImport.jsx';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { go } from '../lib/nav.js';
import { dropSession } from '../lib/tests.js';

const lower = s => String(s || '').toLocaleLowerCase('az');
const SUBS = [
  { tab: 'original', label: 'Orijinal normativ sənəd', icon: FileText, count: l => (l.originals || []).length },
  { tab: 'izah', label: 'İzahlı tədris materialı', icon: BookOpen, count: l => (l.explanation ? 1 : 0) },
  { tab: 'test', label: 'Test paketi', icon: ListChecks, count: l => l.tests?.count || 0 }
];

// active: { type: 'lesson'|'exam', id, tab }
export default function Workspace({ active, title, subtitle, tools, children, ...props }) {
  const { catalog, reload, user } = props;
  const { toast, confirm, prompt } = useUi();
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(() => new Set(active?.type === 'lesson' ? [active.id] : []));
  const [drawer, setDrawer] = useState(false);
  const [adding, setAdding] = useState(false);
  const [folderOpen, setFolderOpen] = useState(false);
  const [drag, setDrag] = useState(null);
  const [order, setOrder] = useState(null);

  // the open lesson is always unfolded; the phone drawer closes after a choice
  useEffect(() => {
    if (active?.type === 'lesson') setOpen(s => (s.has(active.id) ? s : new Set([...s, active.id])));
    setDrawer(false);
  }, [active?.type, active?.id, active?.tab]);

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

  const toggle = (id) => setOpen(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });

  async function rename(l) {
    const title = await prompt({ title: 'Dərsin adını dəyiş', label: 'Dərsin adı', value: l.title });
    if (!title || title === l.title) return;
    try { await api.renameLesson(l.id, title); await reload(); toast('Dərsin adı dəyişdirildi.'); }
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

  /* final exams: add, rename, delete */
  async function addExam() {
    const n = (catalog?.exams || []).length + 1;
    const title = await prompt({ title: 'Yeni yekun sınaq', label: 'Sınağın adı', value: `Yekun sınaq ${n}`, confirmLabel: 'Əlavə et' });
    if (!title) return;
    try { const ex = await api.addExam(title); await reload(); toast(`"${title}" əlavə edildi.`); go(`/sinaq/${ex.id}`); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function renameExam(ex) {
    const title = await prompt({ title: 'Sınağın adını dəyiş', label: 'Ad', value: ex.title });
    if (!title || title === ex.title) return;
    try { await api.saveExam(ex.id, { title }); await reload(); toast('Ad dəyişdirildi.'); }
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

  /* drag to reorder (same as on the main page) */
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
    <>
      <Topbar {...props} onMenu={() => setDrawer(true)}
        title={title} subtitle={subtitle} tools={tools} />
      <div className="workspace">
        {drawer && <div className="ws-scrim" onClick={() => setDrawer(false)} />}
        <aside className={`ws-side ${drawer ? 'show' : ''}`} aria-label="Dərslər">
          <div className="ws-side-top">
            <button className="ws-home" onClick={() => go('/')}><HomeIcon size={15} />Əsas səhifə</button>
            <button className="ws-close" onClick={() => setDrawer(false)} aria-label="Bağla"><X size={16} /></button>
          </div>
          <div className="ws-search">
            <Search size={15} />
            <input value={query} placeholder="Dərs axtar" onChange={e => setQuery(e.target.value)} onKeyDown={e => { if (e.key === 'Escape') setQuery(''); }} />
            {query && <button onClick={() => setQuery('')} aria-label="Təmizlə"><X size={13} /></button>}
          </div>
          <div className="ws-actions">
            <button className="ws-add" onClick={() => setAdding(true)}><Plus size={15} />Dərs əlavə et</button>
            <button className="ws-folder" onClick={() => setFolderOpen(true)} title="Qovluqdan yüklə"><FolderUp size={15} /></button>
          </div>

          <div className="ws-scroll">
            <div className="ws-section"><span>Dərslər</span><em>{lessons.length}</em></div>
            <div className="ws-list" onDragOver={e => drag && e.preventDefault()} onDrop={onDrop}>
              {visible.map(l => {
                const isActive = active?.type === 'lesson' && active.id === l.id;
                const unfolded = open.has(l.id) || !!query.trim();
                const mark = drag?.over === l.id && drag.id !== l.id ? (drag.after ? 'drop-after' : 'drop-before') : '';
                return (
                  <div key={l.id} className={`ws-lesson ${isActive ? 'active' : ''} ${drag?.id === l.id ? 'dragging' : ''} ${mark}`}
                    draggable onDragStart={e => onDragStart(e, l.id)} onDragOver={e => onDragOver(e, l.id)} onDragEnd={() => setDrag(null)}>
                    <div className="ws-row">
                      <button className="ws-open" onClick={() => go(`/ders/${l.id}`)} title={l.title}>
                        <span className="ws-num">{l.number}</span>
                        <span className="ws-name">{l.title}</span>
                      </button>
                      <span className="ws-tools">
                        <button title="Adını dəyiş" onClick={() => rename(l)}><Pencil size={13} /></button>
                        <button className="danger" title={`Dərs ${l.number}-i sil`} onClick={() => remove(l)}><Trash2 size={13} /></button>
                        {!isActive && (
                          <button className={`ws-chev ${unfolded ? 'open' : ''}`} onClick={() => toggle(l.id)} aria-expanded={unfolded} title="Bölmələr">
                            <ChevronRight size={14} />
                          </button>
                        )}
                      </span>
                    </div>
                    {unfolded && (
                      <div className="ws-subs">
                        {SUBS.map(s => {
                          const n = s.count(l);
                          const on = isActive && (active.tab || 'original') === s.tab;
                          return (
                            <button key={s.tab} className={`ws-sub ${on ? 'on' : ''} ${n ? '' : 'empty'}`} onClick={() => go(`/ders/${l.id}/${s.tab}`)}>
                              <span>{s.label}</span><em>{n || ''}</em>
                            </button>
                          );
                        })}
                      </div>
                    )}
                  </div>
                );
              })}
              {!visible.length && <div className="ws-none">{query ? 'Axtarışa uyğun dərs yoxdur.' : 'Hələ dərs yoxdur.'}</div>}
            </div>

            <div className="ws-section"><span>Yekun sınaqlar</span><em>{(catalog?.exams || []).filter(e => e.tests).length} / {(catalog?.exams || []).length}</em>
              <button className="ws-section-add" onClick={addExam} title="Yeni yekun sınaq"><Plus size={14} /></button>
            </div>
            <div className="ws-list">
              {(catalog?.exams || []).map((ex, i) => {
                const on = active?.type === 'exam' && active.id === ex.id;
                return (
                  <div key={ex.id} className={`ws-lesson ws-exam-item ${on ? 'active' : ''} ${ex.tests ? '' : 'empty'}`}>
                    <div className="ws-row">
                      <button className="ws-open" onClick={() => go(`/sinaq/${ex.id}`)} title={ex.title}>
                        <span className="ws-num">{i + 1}</span>
                        <span className="ws-name">{ex.title}</span>
                        <em className="ws-meta">{ex.tests ? `${ex.tests.count} sual` : ''}</em>
                      </button>
                      <span className="ws-tools">
                        <button title="Adını dəyiş" onClick={() => renameExam(ex)}><Pencil size={13} /></button>
                        <button className="danger" title="Sınağı sil" onClick={() => removeExam(ex)}><Trash2 size={13} /></button>
                      </span>
                    </div>
                  </div>
                );
              })}
              {!(catalog?.exams || []).length && <button className="ws-none ws-add-exam" onClick={addExam}>Yekun sınaq əlavə et</button>}
            </div>
          </div>
        </aside>
        <main className="ws-main">{children}</main>
      </div>

      {adding && <AddDialog kind="lesson" catalog={catalog} onClose={() => setAdding(false)}
        onDone={async (res) => { setAdding(false); await reload(); if (res?.go) go(res.go); }} />}
      {folderOpen && <FolderImport catalog={catalog} onClose={() => setFolderOpen(false)} onDone={async () => { await reload(); }} />}
    </>
  );
}
