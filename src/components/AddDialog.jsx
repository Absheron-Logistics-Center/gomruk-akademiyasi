// AddDialog.jsx — add a lesson / final-exam test bank, or add / replace one
// section of an existing lesson. Word test banks are read in the browser first,
// so a bad file is caught before anything is uploaded.
import { useEffect, useRef, useState } from 'react';
import { UploadCloud, X, CheckCircle2, AlertTriangle, Loader2 } from 'lucide-react';
import { Modal, Progress, useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { DOC_ACCEPT, TEST_ACCEPT, fmtSize, extOf, uploadFile, stem } from '../lib/files.js';
import { createLesson, readTestBank, attachTests } from '../lib/ops.js';

const DOC_RE = /\.(pdf|doc|docx|docm|dot|dotx|dotm|rtf|odt|ott|xml|txt)$/i;
const TEST_RE = /\.(doc|docx|docm|dot|dotx|dotm|rtf|odt|ott|xml|txt)$/i;

/**
 * kind: 'lesson' (new lesson or exam) | 'section'
 * edit (kind 'section'): { owner, ownerTitle, section: 'original'|'explanation'|'tests', replace?: doc, isExam? }
 */
export default function AddDialog({ kind, edit, catalog, onClose, onDone }) {
  const { toast } = useUi();
  const [target, setTarget] = useState(edit?.isExam ? edit.owner : 'lesson');   // 'lesson' | exam id
  const [title, setTitle] = useState('');
  const [titleTouched, setTitleTouched] = useState(false);
  const [originals, setOriginals] = useState([]);
  const [explanation, setExplanation] = useState(null);
  const [test, setTest] = useState(null);
  const [bank, setBank] = useState(null);          // { questions, blocked } | { error } | { reading: true }
  const [limit, setLimit] = useState(0);
  const [busy, setBusy] = useState(false);
  const [prog, setProg] = useState({ label: '', value: 0 });
  const [error, setError] = useState('');

  const isSection = kind === 'section';
  const exam = !isSection ? target !== 'lesson' : !!edit?.isExam;
  const section = isSection ? edit.section : null;
  const showOriginals = !isSection ? !exam : section === 'original';
  const showExplanation = !isSection ? !exam : section === 'explanation';
  const showTest = !isSection ? true : section === 'tests';
  const multiOriginals = !isSection || !edit?.replace;

  useEffect(() => {
    if (!isSection && exam) {
      const ex = catalog?.exams?.find(e => e.id === target);
      setLimit(ex?.timeLimitMin || 0);
    }
  }, [target]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the lesson name follows the first chosen file until it is typed by hand
  useEffect(() => {
    if (isSection || exam || titleTouched) return;
    const f = originals[0] || explanation || test;
    setTitle(f ? stem(f.name).replace(/[_]+/g, ' ').replace(/\s+/g, ' ').trim() : '');
  }, [originals, explanation, test, exam, isSection, titleTouched]);

  // read the test bank as soon as it is chosen
  useEffect(() => {
    if (!test) { setBank(null); return; }
    let alive = true;
    setBank({ reading: true });
    readTestBank(test).then(b => { if (alive) setBank(b); }).catch(e => { if (alive) setBank({ error: e.message }); });
    return () => { alive = false; };
  }, [test]);

  const heading = isSection
    ? section === 'original' ? (edit.replace ? 'Normativ aktı dəyişdir' : 'Normativ akt əlavə et')
      : section === 'explanation' ? (edit.replace ? 'İzahlı materialı dəyişdir' : 'İzahlı material əlavə et')
        : (edit.replace ? 'Test bankını dəyişdir' : 'Test bankı əlavə et')
    : 'Dərs əlavə et';
  const sub = isSection ? edit.ownerTitle : 'Fayllar saytın yaddaşında saxlanılır və hamıya görünür.';

  async function submit() {
    setError('');
    if (bank?.reading) { setError('Test faylı hələ oxunur, bir az gözləyin.'); return; }
    if (test && bank?.error) { setError(bank.error); return; }
    try {
      setBusy(true);
      if (isSection) {
        if (section === 'original') {
          if (!originals.length) throw new Error('Ən azı bir sənəd seçin.');
          let i = 0; const total = originals.reduce((a, f) => a + f.size, 0) || 1; let done = 0;
          for (const f of originals) {
            setProg({ label: f.name, value: done / total });
            await uploadFile(f, { owner: edit.owner, section: 'original', ...(edit.replace && i === 0 ? { replace: edit.replace.id } : {}) },
              p => setProg({ label: f.name, value: (done + p * f.size) / total }));
            done += f.size; i++;
          }
          toast(edit.replace ? 'Sənəd dəyişdirildi.' : `${originals.length} sənəd əlavə edildi.`);
        } else if (section === 'explanation') {
          if (!explanation) throw new Error('Faylı seçin.');
          await uploadFile(explanation, { owner: edit.owner, section: 'explanation' }, p => setProg({ label: explanation.name, value: p }));
          toast('İzahlı material yadda saxlanıldı.');
        } else {
          if (!test || !bank?.questions) throw new Error('Word test faylını seçin.');
          await attachTests(edit.owner, test, bank, p => setProg({ label: test.name, value: p }));
          toast(`${bank.questions.length} sual yadda saxlanıldı.${bank.blocked ? ` ${bank.blocked} sualın cavab açarı natamamdır, həmin suallar bloklanır.` : ''}`);
        }
        onDone?.({});
        return;
      }

      if (exam) {
        if (!test || !bank?.questions) throw new Error('Yekun sınaq üçün Word test faylını seçin.');
        setProg({ label: test.name, value: 0 });
        await attachTests(target, test, bank, p => setProg({ label: test.name, value: p }));
        const ex = catalog?.exams?.find(e => e.id === target);
        if ((ex?.timeLimitMin || 0) !== limit) await api.saveExam(target, { timeLimitMin: limit });
        toast(`${ex?.title || 'Yekun sınaq'}: ${bank.questions.length} sual yadda saxlanıldı.`);
        onDone?.({ go: `/sinaq/${target}` });
        return;
      }

      const name = title.trim();
      if (!name) throw new Error('Dərsin adını yazın.');
      if (!originals.length && !explanation && !test) throw new Error('Ən azı bir sənəd, izah və ya test seçin.');
      const res = await createLesson({ title: name, originals, explanation, test, bank: bank?.questions ? bank : null },
        (label, value) => setProg({ label, value }));
      if (res.errors.length) toast(`Dərs yaradıldı, amma bəzi fayllar yüklənmədi: ${res.errors.join('; ')}`, 'error');
      else toast(`"${name}" əlavə edildi.${bank?.blocked ? ` ${bank.blocked} sualın cavab açarı natamamdır.` : ''}`);
      onDone?.({ go: `/ders/${res.lesson.id}` });
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  }

  const ready = !busy && !bank?.reading;
  return (
    <Modal title={heading} sub={sub} onClose={onClose} busy={busy} wide={!isSection}
      footer={<>
        {busy && <div className="foot-progress"><span>{prog.label}</span><Progress value={prog.value} /></div>}
        <button className="btn" onClick={onClose} disabled={busy}>Ləğv et</button>
        <button className="btn primary" onClick={submit} disabled={!ready}>
          {busy ? <><Loader2 size={15} className="spin" />Yüklənir</> : isSection ? 'Yadda saxla' : exam ? 'Sınağı yadda saxla' : 'Dərsi əlavə et'}
        </button>
      </>}>
      <div className="add-form">
        {!isSection && (
          <div className="field-block">
            <label>Nə əlavə edirsiniz?</label>
            <div className="seg">
              <button type="button" className={target === 'lesson' ? 'on' : ''} onClick={() => setTarget('lesson')} disabled={busy}>Adi dərs</button>
              {(catalog?.exams || []).map((e, i) => (
                <button type="button" key={e.id} className={target === e.id ? 'on' : ''} onClick={() => setTarget(e.id)} disabled={busy}>Yekun sınaq {i + 1}</button>
              ))}
            </div>
          </div>
        )}

        {!isSection && !exam && (
          <div className="field-block">
            <label htmlFor="ga-title">Dərsin adı</label>
            <input id="ga-title" type="text" maxLength={250} value={title} disabled={busy}
              placeholder="Məsələn: Azərbaycan Respublikasının Gömrük Məcəlləsi"
              onChange={e => { setTitle(e.target.value); setTitleTouched(true); }} />
          </div>
        )}

        {showOriginals && (
          <Drop label={isSection ? 'Sənəd' : '1. Orijinal normativ sənədlər'}
            hint={multiOriginals ? 'Word və ya PDF. Bir dərs üçün bir neçə fayl seçmək olar.' : 'Word və ya PDF. Seçilmiş sənədin yerinə keçəcək.'}
            accept={DOC_ACCEPT} re={DOC_RE} multiple={multiOriginals} files={originals} onFiles={setOriginals} disabled={busy} />
        )}
        {showExplanation && (
          <Drop label={isSection ? 'İzahlı material' : '2. İzahlı tədris materialı'} hint="Word və ya PDF, bir fayl. Məcburi deyil."
            accept={DOC_ACCEPT} re={DOC_RE} files={explanation ? [explanation] : []} onFiles={f => setExplanation(f[0] || null)} disabled={busy} />
        )}
        {showTest && (
          <Drop label={isSection ? 'Word test bankı' : exam ? 'Word test bankı' : '3. Testlər'}
            hint={exam ? 'Yekun sınaq üçün məcburidir. PDF test kimi qəbul edilmir.' : 'Word formatı. PDF test kimi qəbul edilmir.'}
            accept={TEST_ACCEPT} re={TEST_RE} files={test ? [test] : []} onFiles={f => setTest(f[0] || null)} disabled={busy}
            status={bank && (bank.reading
              ? <span className="bank-status"><Loader2 size={14} className="spin" />Suallar oxunur</span>
              : bank.error
                ? <span className="bank-status bad"><AlertTriangle size={14} />{bank.error}</span>
                : <span className="bank-status good"><CheckCircle2 size={14} />{bank.questions.length} sual tapıldı{bank.blocked ? `, ${bank.blocked} sualın cavab açarı natamamdır` : ''}</span>)} />
        )}

        {exam && !isSection && (
          <div className="field-block inline">
            <label htmlFor="ga-limit">Vaxt (dəqiqə)</label>
            <input id="ga-limit" type="number" min={0} max={600} value={limit} disabled={busy} onChange={e => setLimit(Math.max(0, Math.min(600, Number(e.target.value) || 0)))} />
            <span className="field-note">0 yazsanız vaxt göstərilmir. Vaxt bitəndə test dayanmır, yalnız xəbərdarlıq olur.</span>
          </div>
        )}

        {showTest && (
          <div className="note-box">
            Düzgün cavab Word faylında <b>qırmızı rənglə</b> işarələnməli və ya <b>DÜZGÜN CAVAB: B</b> kimi yazılmalıdır.
            Sual tanınmasa, proqram cavabı təxmin etmir, həmin sualı bloklayır.
          </div>
        )}
        {(showOriginals || showExplanation) && !exam && (
          <div className="note-box soft">
            PDF sənədin əsl görünüşünü saxlayır. Word faylı brauzerdə sadələşdirilmiş görünüşlə açılır; orijinalı istənilən vaxt endirmək olar.
            Köhnə .doc və .rtf fayllarından yalnız mətn oxunur.
          </div>
        )}

        {error && <div className="form-error">{error}</div>}
      </div>
    </Modal>
  );
}

function Drop({ label, hint, accept, re, multiple, files, onFiles, disabled, status }) {
  const input = useRef(null);
  const [over, setOver] = useState(false);
  const add = (list) => {
    const arr = Array.from(list || []).filter(f => re.test(f.name));
    if (!arr.length) return;
    onFiles(multiple ? [...files, ...arr.filter(f => !files.some(x => x.name === f.name && x.size === f.size))] : [arr[0]]);
  };
  return (
    <div className="field-block">
      <label>{label}</label>
      <div className={`drop ${over ? 'over' : ''} ${disabled ? 'disabled' : ''}`}
        onClick={() => !disabled && input.current?.click()}
        onDragOver={e => { e.preventDefault(); if (!disabled) setOver(true); }}
        onDragLeave={() => setOver(false)}
        onDrop={e => { e.preventDefault(); setOver(false); if (!disabled) add(e.dataTransfer.files); }}>
        <UploadCloud size={20} />
        <span><b>Fayl seçin</b> və ya bura sürüşdürün</span>
        <small>{hint}</small>
        <input ref={input} type="file" hidden accept={accept} multiple={multiple}
          onChange={e => { add(e.target.files); e.target.value = ''; }} />
      </div>
      {files.length > 0 && (
        <ul className="file-list">
          {files.map((f, i) => (
            <li key={`${f.name}-${i}`}>
              <span className={`ftype ${extOf(f.name) === 'pdf' ? 'pdf' : 'word'}`}>{extOf(f.name).toUpperCase()}</span>
              <span className="fname" title={f.name}>{f.name}</span>
              <span className="fsize">{fmtSize(f.size)}</span>
              {!disabled && (
                <button type="button" className="fdel" aria-label="Çıxar" onClick={() => onFiles(files.filter((_, j) => j !== i))}><X size={14} /></button>
              )}
            </li>
          ))}
        </ul>
      )}
      {status}
    </div>
  );
}

