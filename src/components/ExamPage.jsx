import { useState } from 'react';
import { GraduationCap, Plus, Replace, Trash2, Pencil, Timer, Download, Loader2, FileQuestion, ChevronLeft, ChevronRight } from 'lucide-react';
import Topbar from './Topbar.jsx';
import Workspace from './Workspace.jsx';
import TestPanel from './TestPanel.jsx';
import AddDialog from './AddDialog.jsx';
import { Missing } from './LessonPage.jsx';
import { useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { go } from '../lib/nav.js';
import { loadDoc, saveBlob, extOf, cacheDrop } from '../lib/files.js';
import { dropSession } from '../lib/tests.js';

export default function ExamPage(props) {
  const { catalog, reload, id, user } = props;
  const { toast, confirm, prompt } = useUi();
  const [dialog, setDialog] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const back = () => go('/');

  const index = catalog ? catalog.exams.findIndex(e => e.id === id) : -1;
  const exam = index >= 0 ? catalog.exams[index] : null;
  const prev = index > 0 ? catalog.exams[index - 1] : null;
  const next = index >= 0 && index < (catalog?.exams.length || 0) - 1 ? catalog.exams[index + 1] : null;

  if (!catalog) return <><Topbar {...props} back={back} backLabel="Dərslər" /><div className="page-wrap"><div className="empty-state"><Loader2 size={18} className="spin" />Yüklənir</div></div></>;
  if (!exam) {
    return (
      <>
        <Topbar {...props} back={back} backLabel="Dərslər" />
        <div className="page-wrap"><Missing icon={FileQuestion} title="Sınaq tapılmadı" text="Ünvan səhvdir." action={<button className="btn primary small" onClick={back}>Geri qayıt</button>} /></div>
      </>
    );
  }

  async function rename() {
    const title = await prompt({ title: 'Sınağın adını dəyiş', label: 'Ad', value: exam.title });
    if (!title || title === exam.title) return;
    try { await api.saveExam(exam.id, { title }); await reload(); toast('Ad dəyişdirildi.'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function setLimit() {
    const v = await prompt({ title: 'Sınağın vaxtı', label: 'Dəqiqə (0 = vaxt göstərilmir)', value: exam.timeLimitMin || 0, type: 'number', min: 0, max: 600 });
    if (v === null || v === undefined) return;
    try { await api.saveExam(exam.id, { timeLimitMin: v }); await reload(); toast(v ? `Vaxt ${v} dəqiqə oldu.` : 'Vaxt götürüldü.'); }
    catch (e) { toast(e.message, 'error'); }
  }
  async function removeTests() {
    const ok = await confirm({ title: 'Test bankı silinsin?', danger: true, confirmLabel: 'Sil', text: `${exam.title} üçün test bankı hamı üçün silinəcək.` });
    if (!ok) return;
    try {
      await api.deleteSection(exam.id, 'tests');
      if (exam.tests?.source?.id) cacheDrop(exam.tests.source.id);
      dropSession(user?.username, `exam:${exam.id}`);
      await reload(); toast('Test bankı silindi.');
    } catch (e) { toast(e.message, 'error'); }
  }
  async function downloadSource() {
    setDownloading(true);
    try { saveBlob(await loadDoc(exam.tests.source), exam.tests.source.name); }
    catch (e) { toast(e.message, 'error'); }
    finally { setDownloading(false); }
  }

  return (
    <>
      <Workspace {...props} active={{ type: 'exam', id: exam.id }} crumb="Yekun sınaqlar">
      <div className="ws-page">
        <header className="lesson-head">
          <span className="lesson-no exam"><GraduationCap size={20} /></span>
          <div className="lesson-title">
            <span className="lesson-kicker">Yekun sınaq {index + 1} / {catalog.exams.length}</span>
            <h1>{exam.title}</h1>
          </div>
          <div className="lesson-tools">
            <button className="group-act-btn" title="Əvvəlki sınaq" disabled={!prev} onClick={() => prev && go(`/sinaq/${prev.id}`)}><ChevronLeft size={15} /></button>
            <button className="group-act-btn" title="Növbəti sınaq" disabled={!next} onClick={() => next && go(`/sinaq/${next.id}`)}><ChevronRight size={15} /></button>
            <span className="tool-sep" />
            <button className="group-act-btn" title="Adını dəyiş" onClick={rename}><Pencil size={14} /></button>
          </div>
        </header>

        <section className="tab-body">
          <div className="section-bar">
            <div className="doc-chips">
              {exam.tests?.source && <span className="doc-chip on static"><span className="ftype word">{extOf(exam.tests.source.name).toUpperCase()}</span><span className="doc-chip-name">{exam.tests.source.name.replace(/\.[^.]+$/, '')}</span></span>}
              <button className="doc-chip" onClick={setLimit} title="Vaxtı dəyiş"><Timer size={14} />{exam.timeLimitMin ? `${exam.timeLimitMin} dəqiqə` : 'Vaxt yoxdur'}</button>
            </div>
            <div className="section-actions">
              <button className="action-btn" onClick={() => setDialog(true)}>{exam.tests ? <><Replace size={14} />Dəyişdir</> : <><Plus size={14} />Test bankı əlavə et</>}</button>
              {exam.tests?.source && <button className="action-btn" onClick={downloadSource} disabled={downloading}>{downloading ? <Loader2 size={14} className="spin" /> : <Download size={14} />}Word faylı</button>}
              {exam.tests && <button className="action-btn action-btn-danger" onClick={removeTests}><Trash2 size={14} />Sil</button>}
            </div>
          </div>
          {exam.tests ? (
            <TestPanel key={`${exam.id}:${exam.tests.updatedAt}`} type="exam" id={exam.id} name={exam.title} tests={exam.tests} limitMin={exam.timeLimitMin} user={user}
              onBack={back} backLabel="Dərslərə qayıt" />
          ) : (
            <Missing icon={GraduationCap} title="Test bankı əlavə edilməyib" text="Yekun sınaq yalnız testdən ibarətdir. Word test bankını əlavə edin, istəsəniz vaxt da təyin edin."
              action={<button className="btn primary small" onClick={() => setDialog(true)}><Plus size={14} />Test bankı əlavə et</button>} />
          )}
        </section>
      </div>
      </Workspace>
      {dialog && <AddDialog kind="section" edit={{ owner: exam.id, ownerTitle: exam.title, section: 'tests', replace: exam.tests, isExam: true }} catalog={catalog}
        onClose={() => setDialog(false)} onDone={async () => { setDialog(false); await reload(); }} />}
    </>
  );
}
