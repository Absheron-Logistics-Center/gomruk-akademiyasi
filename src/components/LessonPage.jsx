import { useEffect, useMemo, useState } from 'react';
import { FileText, BookOpen, ListChecks, Plus, RefreshCw, Trash2, Download, Loader2, ChevronDown, FileQuestion } from 'lucide-react';
import Workspace, { Seg } from './Workspace.jsx';
import Drop from './Drop.jsx';
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

  const setTab = (t) => go(`/ders/${id}/${t}`);
  const back = () => go('/');

  if (!catalog) {
    return <Workspace {...props} active={{ type: 'lesson', id }} title="Yüklənir"><div className="empty-state"><Loader2 size={18} className="spin" />Yüklənir</div></Workspace>;
  }
  if (!lesson) {
    return (
      <Workspace {...props} active={{ type: 'lesson', id }} title="Dərs tapılmadı">
        <Missing icon={FileQuestion} title="Dərs tapılmadı" text="Bu dərs silinib və ya ünvan səhvdir." action={<button className="btn primary small" onClick={back}>Dərslərə qayıt</button>} />
      </Workspace>
    );
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
  const seg = <Seg value={current} onChange={setTab} items={TABS.map(t => ({ key: t.key, label: t.short, count: counts[t.key] }))} />;

  const picker = current === 'original' && originals.length > 1 ? (
    <Drop className="vfile-pick" title="Sənədi seç" button={<><FileTag name={doc.name} /><ChevronDown size={14} /></>}>
      {originals.map(d => (
        <button key={d.id} onClick={() => setSelected(d.id)} className={d.id === doc.id ? 'on' : ''}>
          <span className={`ftype ${extOf(d.name) === 'pdf' ? 'pdf' : 'word'}`}>{extOf(d.name) === 'pdf' ? 'PDF' : extOf(d.name).toUpperCase()}</span>
          <span className="drop-name">{d.name.replace(/\.[^.]+$/, '')}</span>
          <em>{fmtSize(d.size)}</em>
        </button>
      ))}
    </Drop>
  ) : doc ? <span className="vfile-one" title={doc.name}><FileTag name={doc.name} /></span> : null;

  const docActions = (section) => <>
    <button className="vb" onClick={() => openDialog(section, doc)} title="Faylı dəyişdir"><RefreshCw size={16} /></button>
    <button className="vb danger" onClick={() => removeSection(section, doc)} title="Faylı sil"><Trash2 size={16} /></button>
    {section === 'original' && <button className="vadd" onClick={() => openDialog('original')}><Plus size={15} />Sənəd</button>}
  </>;

  return (
    <>
      <Workspace {...props} active={{ type: 'lesson', id: lesson.id, tab: current }}
        kicker={`Dərs ${index + 1}`} title={lesson.title} seg={seg} fill={current !== 'test'}
        nav={{ prev: prev && `/ders/${prev.id}/${current}`, next: next && `/ders/${next.id}/${current}` }}>

        {current === 'original' && (doc
          ? <Reader key={doc.id} doc={doc} label="Normativ sənəd" fileSlot={picker} actions={docActions('original')} />
          : <Missing icon={FileText} title="Normativ sənəd əlavə edilməyib" text="Bu dərsə aid Word və ya PDF normativ aktları əlavə edin. Bir neçə sənəd əlavə etmək olar. Word faylları avtomatik PDF-ə çevrilir."
            action={<button className="btn primary small" onClick={() => openDialog('original')}><Plus size={14} />Sənəd əlavə et</button>} />)}

        {current === 'izah' && (doc
          ? <Reader key={doc.id} doc={doc} label="İzahlı material" fileSlot={picker} actions={docActions('explanation')} />
          : <Missing icon={BookOpen} title="İzahlı material əlavə edilməyib" text="Normativ aktın izahını Word və ya PDF faylı kimi əlavə edin. Word faylı avtomatik PDF-ə çevrilir."
            action={<button className="btn primary small" onClick={() => openDialog('explanation')}><Plus size={14} />İzah əlavə et</button>} />)}

        {current === 'test' && (
          <div className="test-page">
            <div className="test-bar">
              {lesson.tests?.source
                ? <span className="vfile-one" title={lesson.tests.source.name}><FileTag name={lesson.tests.source.name} /><em>{lesson.tests.count} sual</em></span>
                : <span className="test-bar-title">Test paketi</span>}
              <span className="vbar-grow" />
              {lesson.tests?.source && <button className="vb" onClick={downloadSource} disabled={downloading} title="Word faylını endir">{downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}</button>}
              {lesson.tests && <button className="vb" onClick={() => openDialog('tests', lesson.tests)} title="Test bankını dəyişdir"><RefreshCw size={16} /></button>}
              {lesson.tests && <button className="vb danger" onClick={() => removeSection('tests', lesson.tests?.source)} title="Test bankını sil"><Trash2 size={16} /></button>}
              {!lesson.tests && <button className="vadd" onClick={() => openDialog('tests')}><Plus size={15} />Test bankı</button>}
            </div>
            {lesson.tests ? (
              <TestPanel key={`${lesson.id}:${lesson.tests.updatedAt}`} type="lesson" id={lesson.id} name={lesson.title} tests={lesson.tests} user={user}
                onBack={() => setTab(lesson.originals?.length ? 'original' : 'izah')} backLabel="Dərsə qayıt" />
            ) : (
              <Missing icon={ListChecks} title="Test bankı əlavə edilməyib" text="Word test bankını əlavə edin: suallar avtomatik oxunur və burada interaktiv işlənir."
                action={<button className="btn primary small" onClick={() => openDialog('tests')}><Plus size={14} />Test bankı əlavə et</button>} />
            )}
          </div>
        )}
      </Workspace>

      {dialog && <AddDialog kind="section" edit={dialog} catalog={catalog} onClose={() => setDialog(null)}
        onDone={async () => { setDialog(null); await reload(); }} />}
    </>
  );
}

export function FileTag({ name }) {
  const ext = extOf(name);
  return <><span className={`ftype ${ext === 'pdf' ? 'pdf' : 'word'}`}>{ext === 'pdf' ? 'PDF' : ext.toUpperCase()}</span><b>{name.replace(/\.[^.]+$/, '')}</b></>;
}

export function Missing({ icon: Icon, title, text, action }) {
  return (
    <div className="missing"><div className="ga-card ga-empty">
      <Icon size={26} />
      <strong>{title}</strong>
      <span>{text}</span>
      {action}
    </div></div>
  );
}
