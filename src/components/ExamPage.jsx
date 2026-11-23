import { useState } from 'react';
import { GraduationCap, Plus, RefreshCw, Trash2, Timer, Download, Loader2, FileQuestion } from 'lucide-react';
import Workspace from './Workspace.jsx';
import TestPanel from './TestPanel.jsx';
import AddDialog from './AddDialog.jsx';
import { Missing, FileTag } from './LessonPage.jsx';
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

  if (!catalog) return <Workspace {...props} active={{ type: 'exam', id }} title="Yüklənir"><div className="empty-state"><Loader2 size={18} className="spin" />Yüklənir</div></Workspace>;
  if (!exam) {
    return (
      <Workspace {...props} active={{ type: 'exam', id }} title="Sınaq tapılmadı">
        <Missing icon={FileQuestion} title="Sınaq tapılmadı" text="Bu sınaq silinib və ya ünvan səhvdir." action={<button className="btn primary small" onClick={back}>Dərslərə qayıt</button>} />
      </Workspace>
    );
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
      <Workspace {...props} active={{ type: 'exam', id: exam.id }}
        kicker={`Yekun sınaq ${index + 1} / ${catalog.exams.length}`} title={exam.title}
        nav={{ prev: prev && `/sinaq/${prev.id}`, next: next && `/sinaq/${next.id}` }}>
        <div className="test-page">
          <div className="test-bar">
            {exam.tests?.source
              ? <span className="vfile-one" title={exam.tests.source.name}><FileTag name={exam.tests.source.name} /><em>{exam.tests.count} sual</em></span>
              : <span className="test-bar-title">Test bankı</span>}
            <button className="vchip" onClick={setLimit} title="Vaxtı dəyiş"><Timer size={14} />{exam.timeLimitMin ? `${exam.timeLimitMin} dəqiqə` : 'Vaxt yoxdur'}</button>
            <span className="vbar-grow" />
            {exam.tests?.source && <button className="vb" onClick={downloadSource} disabled={downloading} title="Word faylını endir">{downloading ? <Loader2 size={16} className="spin" /> : <Download size={16} />}</button>}
            {exam.tests && <button className="vb" onClick={() => setDialog(true)} title="Test bankını dəyişdir"><RefreshCw size={16} /></button>}
            {exam.tests && <button className="vb danger" onClick={removeTests} title="Test bankını sil"><Trash2 size={16} /></button>}
            {!exam.tests && <button className="vadd" onClick={() => setDialog(true)}><Plus size={15} />Test bankı</button>}
          </div>
          {exam.tests ? (
            <TestPanel key={`${exam.id}:${exam.tests.updatedAt}`} type="exam" id={exam.id} name={exam.title} tests={exam.tests} limitMin={exam.timeLimitMin} user={user}
              onBack={back} backLabel="Dərslərə qayıt" />
          ) : (
            <Missing icon={GraduationCap} title="Test bankı əlavə edilməyib" text="Yekun sınaq yalnız testdən ibarətdir. Word test bankını əlavə edin, istəsəniz vaxt da təyin edin."
              action={<button className="btn primary small" onClick={() => setDialog(true)}><Plus size={14} />Test bankı əlavə et</button>} />
          )}
        </div>
      </Workspace>
      {dialog && <AddDialog kind="section" edit={{ owner: exam.id, ownerTitle: exam.title, section: 'tests', replace: exam.tests, isExam: true }} catalog={catalog}
        onClose={() => setDialog(false)} onDone={async () => { setDialog(false); await reload(); }} />}
    </>
  );
}
