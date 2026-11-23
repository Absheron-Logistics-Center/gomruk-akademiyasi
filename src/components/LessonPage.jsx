import { useEffect, useMemo, useState } from 'react';
import {
  FileText, BookOpen, ListChecks, Plus, Replace, Trash2, Pencil, Download, Loader2, ChevronLeft, ChevronRight, FileQuestion
} from 'lucide-react';
import Topbar from './Topbar.jsx';
import Workspace from './Workspace.jsx';
import Reader from './Reader.jsx';
import TestPanel from './TestPanel.jsx';
import AddDialog from './AddDialog.jsx';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { go } from '../lib/nav.js';
import { loadDoc, saveBlob, extOf, fmtSize, cacheDrop } from '../lib/files.js';
import { dropSession } from '../lib/tests.js';

const TABS = [
  { key: 'original', label: 'Orijinal normativ sənəd', short: 'Orijinal', icon: FileText },
  { key: 'izah', label: 'İzahlı tədris materialı', short: 'İzah', icon: BookOpen },
  { key: 'test', label: 'Test paketi', short: 'Test', icon: ListChecks }
];

export default function LessonPage(props) {
  const { catalog, reload, id, tab, user } = props;
  const { toast, confirm, prompt } = useUi();
  const [selected, setSelected] = useState(null);   // original doc id
  const [dialog, setDialog] = useState(null);
  const [downloading, setDownloading] = useState(false);

  const index = catalog ? catalog.lessons.findIndex(l => l.id === id) : -1;
  const lesson = index >= 0 ? catalog.lessons[index] : null;
  const prev = index > 0 ? catalog.lessons[index - 1] : null;
  const next = index >= 0 && index < (catalog?.lessons.length || 0) - 1 ? catalog.lessons[index + 1] : null;

  const firstTab = lesson ? (lesson.originals?.length ? 'original' : lesson.explanation ? 'izah' : lesson.tests ? 'test' : 'original') : 'original';
  const current = tab || firstTab;

  const originals = useMemo(() => lesson?.originals || [], [lesson]);
  const doc = current === 'original'
    ? originals.find(d => d.id === selected) || originals[0] || null
    : current === 'izah' ? lesson?.explanation || null : null;

  useEffect(() => { if (selected && !originals.some(d => d.id === selected)) setSelected(null); }, [originals, selected]);
  useEffect(() => { window.scrollTo(0, 0); }, [id]);

  const setTab = (t) => go(`/ders/${id}/${t}`);
  const back = () => go('/');

  if (!catalog) {
    return <><Topbar {...props} back={back} backLabel="Dərslər" /><div className="page-wrap"><div className="empty-state"><Loader2 size={18} className="spin" />Yüklənir</div></div></>;
  }
  if (!lesson) {
    return (
      <>
        <Topbar {...props} back={back} backLabel="Dərslər" />
        <div className="page-wrap">
          <div className="ga-card ga-empty">
            <FileQuestion size={26} />
            <strong>Dərs tapılmadı</strong>
            <span>Bu dərs silinib və ya ünvan səhvdir.</span>
            <button className="btn primary small" onClick={back}>Dərslərə qayıt</button>
          </div>
        </div>
      </>
    );
  }

  async function rename() {
    const title = await prompt({ title: 'Dərsin adını dəyiş', label: 'Dərsin adı', value: lesson.title });
    if (!title || title === lesson.title) return;
    try { await api.renameLesson(lesson.id, title); await reload(); toast('Dərsin adı dəyişdirildi.'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function removeLesson() {
    const ok = await confirm({
      title: 'Dərs silinsin?', danger: true, confirmLabel: 'Dərsi sil',
      text: `"${lesson.title}" və onun bütün sənədləri, izahı və testləri silinəcək. Silinmə hamı üçündür və geri qaytarılmır.`
    });
    if (!ok) return;
    try { await api.deleteLesson(lesson.id); dropSession(user?.username, `lesson:${lesson.id}`); await reload(); toast('Dərs silindi.'); go('/'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function removeSection(section, d) {
    const what = section === 'original' ? `"${d.name}" sənədi` : section === 'explanation' ? 'İzahlı material' : 'Bu dərsin test bankı';
    const ok = await confirm({
      title: 'Silinsin?', danger: true, confirmLabel: 'Sil',
      text: `${what} silinəcək. Digər materiallar qalır. Silinmə hamı üçündür.`
    });
    if (!ok) return;
    try {
      await api.deleteSection(lesson.id, section, section === 'original' ? d.id : undefined);
      if (d?.id) cacheDrop(d.id);
      if (section === 'tests') dropSession(user?.username, `lesson:${lesson.id}`);
      await reload();
      toast('Silindi.');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function downloadSource() {
    const src = lesson.tests?.source;
    if (!src) return;
    setDownloading(true);
    try { saveBlob(await loadDoc(src), src.name); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDownloading(false); }
  }

  const openDialog = (section, replace) => setDialog({ owner: lesson.id, ownerTitle: lesson.title, section, replace });
  const counts = { original: originals.length, izah: lesson.explanation ? 1 : 0, test: lesson.tests?.count || 0 };

  return (
    <>
      <Workspace {...props} active={{ type: 'lesson', id: lesson.id, tab: current }} crumb={`Dərs ${index + 1}`}>
      <div className="ws-page">
        <header className="lesson-head">
          <span className="lesson-no">{index + 1}</span>
          <div className="lesson-title">
            <span className="lesson-kicker">Dərs {index + 1} / {catalog.lessons.length}</span>
            <h1>{lesson.title}</h1>
          </div>
          <div className="lesson-tools">
            <button className="group-act-btn" title="Əvvəlki dərs" disabled={!prev} onClick={() => prev && go(`/ders/${prev.id}`)}><ChevronLeft size={15} /></button>
            <button className="group-act-btn" title="Növbəti dərs" disabled={!next} onClick={() => next && go(`/ders/${next.id}`)}><ChevronRight size={15} /></button>
            <span className="tool-sep" />
            <button className="group-act-btn" title="Adını dəyiş" onClick={rename}><Pencil size={14} /></button>
            <button className="group-act-btn danger" title="Dərsi sil" onClick={removeLesson}><Trash2 size={14} /></button>
          </div>
        </header>

        <nav className="tabs" role="tablist">
          {TABS.map(t => {
            const Icon = t.icon;
            return (
              <button key={t.key} role="tab" aria-selected={current === t.key} className={`tab ${current === t.key ? 'on' : ''}`} onClick={() => setTab(t.key)}>
                <Icon size={16} />
                <span className="tab-long">{t.label}</span><span className="tab-short">{t.short}</span>
                <span className={`tab-count ${counts[t.key] ? '' : 'zero'}`}>{t.key === 'test' ? (counts.test ? `${counts.test}` : '0') : counts[t.key]}</span>
              </button>
            );
          })}
        </nav>

        {current === 'original' && (
          <section className="tab-body">
            <div className="section-bar">
              <div className="doc-chips">
                {originals.map(d => (
                  <button key={d.id} className={`doc-chip ${doc?.id === d.id ? 'on' : ''}`} onClick={() => setSelected(d.id)} title={`${d.name} · ${fmtSize(d.size)}`}>
                    <span className={`ftype ${extOf(d.name) === 'pdf' ? 'pdf' : 'word'}`}>{extOf(d.name).toUpperCase()}</span>
                    <span className="doc-chip-name">{d.name.replace(/\.[^.]+$/, '')}</span>
                  </button>
                ))}
              </div>
              <div className="section-actions">
                <button className="action-btn" onClick={() => openDialog('original')}><Plus size={14} />Əlavə et</button>
                {doc && <button className="action-btn" onClick={() => openDialog('original', doc)}><Replace size={14} />Dəyişdir</button>}
                {doc && <button className="action-btn action-btn-danger" onClick={() => removeSection('original', doc)}><Trash2 size={14} />Sil</button>}
              </div>
            </div>
            {doc ? <Reader key={doc.id} doc={doc} label="Normativ sənəd" /> : (
              <Missing icon={FileText} title="Normativ sənəd əlavə edilməyib" text="Bu dərsə aid Word və ya PDF normativ aktları əlavə edin. Bir neçə sənəd əlavə etmək olar."
                action={<button className="btn primary small" onClick={() => openDialog('original')}><Plus size={14} />Sənəd əlavə et</button>} />
            )}
          </section>
        )}

        {current === 'izah' && (
          <section className="tab-body">
            <div className="section-bar">
              <div className="doc-chips">
                {doc && <span className="doc-chip on static"><span className={`ftype ${extOf(doc.name) === 'pdf' ? 'pdf' : 'word'}`}>{extOf(doc.name).toUpperCase()}</span><span className="doc-chip-name">{doc.name.replace(/\.[^.]+$/, '')}</span></span>}
              </div>
              <div className="section-actions">
                <button className="action-btn" onClick={() => openDialog('explanation', doc)}>{doc ? <><Replace size={14} />Dəyişdir</> : <><Plus size={14} />Əlavə et</>}</button>
                {doc && <button className="action-btn action-btn-danger" onClick={() => removeSection('explanation', doc)}><Trash2 size={14} />Sil</button>}
              </div>
            </div>
            {doc ? <Reader key={doc.id} doc={doc} label="İzahlı material" /> : (
              <Missing icon={BookOpen} title="İzahlı material əlavə edilməyib" text="Normativ aktın izahını Word və ya PDF faylı kimi əlavə edin."
                action={<button className="btn primary small" onClick={() => openDialog('explanation')}><Plus size={14} />İzah əlavə et</button>} />
            )}
          </section>
        )}

        {current === 'test' && (
          <section className="tab-body">
            <div className="section-bar">
              <div className="doc-chips">
                {lesson.tests?.source && <span className="doc-chip on static"><span className="ftype word">{extOf(lesson.tests.source.name).toUpperCase()}</span><span className="doc-chip-name">{lesson.tests.source.name.replace(/\.[^.]+$/, '')}</span></span>}
              </div>
              <div className="section-actions">
                <button className="action-btn" onClick={() => openDialog('tests', lesson.tests)}>{lesson.tests ? <><Replace size={14} />Dəyişdir</> : <><Plus size={14} />Əlavə et</>}</button>
                {lesson.tests?.source && <button className="action-btn" onClick={downloadSource} disabled={downloading}>{downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}Word faylı</button>}
                {lesson.tests && <button className="action-btn action-btn-danger" onClick={() => removeSection('tests', lesson.tests?.source)}><Trash2 size={14} />Sil</button>}
              </div>
            </div>
            {lesson.tests ? (
              <TestPanel key={`${lesson.id}:${lesson.tests.updatedAt}`} type="lesson" id={lesson.id} name={lesson.title} tests={lesson.tests} user={user}
                onBack={() => setTab(lesson.originals?.length ? 'original' : 'izah')} backLabel="Dərsə qayıt" />
            ) : (
              <Missing icon={ListChecks} title="Test bankı əlavə edilməyib" text="Word test bankını əlavə edin: suallar avtomatik oxunur və burada interaktiv işlənir."
                action={<button className="btn primary small" onClick={() => openDialog('tests')}><Plus size={14} />Test bankı əlavə et</button>} />
            )}
          </section>
        )}
      </div>
      </Workspace>

      {dialog && <AddDialog kind="section" edit={dialog} catalog={catalog} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); await reload(); }} />}
    </>
  );
}

export function Missing({ icon: Icon, title, text, action }) {
  return (
    <div className="ga-card ga-empty">
      <Icon size={26} />
      <strong>{title}</strong>
      <span>{text}</span>
      {action}
    </div>
  );
}
