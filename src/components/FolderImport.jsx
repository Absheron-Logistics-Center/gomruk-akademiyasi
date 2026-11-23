// FolderImport.jsx — load a whole DERSLER folder (Ders_01/ORIGINAL, IZAH, TEST, BASLIQ.txt).
import { useRef, useState } from 'react';
import { FolderOpen, Loader2, CheckCircle2, AlertTriangle, Clock3, FileText, BookOpen, ListChecks } from 'lucide-react';
import { Modal, Progress, useUi } from './ui.jsx';
import { groupFolder, createLesson, readTestBank } from '../lib/ops.js';
import { fmtSize } from '../lib/files.js';

const lower = s => String(s || '').toLocaleLowerCase('az').trim();

// files of a folder dropped onto the page (Chrome / Edge give entries)
async function filesFromDrop(items) {
  const out = [];
  const walk = (entry, path) => new Promise(resolve => {
    if (entry.isFile) {
      entry.file(f => { try { Object.defineProperty(f, 'webkitRelativePath', { value: path + f.name }); } catch { /* ignore */ } out.push(f); resolve(); }, () => resolve());
    } else if (entry.isDirectory) {
      const reader = entry.createReader();
      const all = [];
      const read = () => reader.readEntries(async batch => {
        if (!batch.length) { for (const e of all) await walk(e, `${path}${entry.name}/`); resolve(); return; }
        all.push(...batch); read();
      }, () => resolve());
      read();
    } else resolve();
  });
  for (const it of Array.from(items || [])) {
    const e = it.webkitGetAsEntry?.();
    if (e) await walk(e, '');
  }
  return out;
}

export default function FolderImport({ catalog, onClose, onDone }) {
  const { toast } = useUi();
  const input = useRef(null);
  const [groups, setGroups] = useState(null);
  const [scanning, setScanning] = useState(false);
  const [picked, setPicked] = useState({});
  const [state, setState] = useState({});      // dir -> { stage, value, note }
  const [busy, setBusy] = useState(false);
  const [finished, setFinished] = useState(false);
  const [over, setOver] = useState(false);

  const existing = new Set((catalog?.lessons || []).map(l => lower(l.title)));

  async function scan(files) {
    setScanning(true);
    try {
      const g = await groupFolder(files);
      if (!g.length) { toast('DERSLER/Ders_01/ORIGINAL, IZAH və TEST qovluqları tapılmadı.', 'error'); setGroups(null); return; }
      setGroups(g);
      setPicked(Object.fromEntries(g.map(x => [x.dir, !existing.has(lower(x.title))])));
      setState({}); setFinished(false);
    } finally { setScanning(false); }
  }

  async function run() {
    const list = groups.filter(g => picked[g.dir]);
    if (!list.length) { toast('Ən azı bir dərs seçin.'); return; }
    setBusy(true);
    let ok = 0, bad = 0;
    for (const g of list) {
      const set = (s) => setState(st => ({ ...st, [g.dir]: { ...st[g.dir], ...s } }));
      try {
        let bank = null, test = g.test, note = '';
        if (test) {
          set({ stage: 'reading', value: 0 });
          try { bank = await readTestBank(test); }
          catch (e) { note = `Test oxunmadı: ${e.message}`; test = null; }
        }
        set({ stage: 'upload', value: 0 });
        const res = await createLesson({ title: g.title, originals: g.originals, explanation: g.explanation, test, bank },
          (_label, value) => set({ value }));
        const issues = [note, ...res.errors].filter(Boolean);
        set({ stage: issues.length ? 'warn' : 'done', value: 1, note: issues.join('; ') || (bank ? `${bank.questions.length} sual` : '') });
        ok++;
      } catch (e) {
        set({ stage: 'error', note: e.message });
        bad++;
      }
    }
    setBusy(false); setFinished(true);
    await onDone?.();
    toast(`${ok} dərs yükləndi.${bad ? ` ${bad} dərsdə xəta oldu.` : ''}`, bad ? 'error' : 'info');
  }

  const count = groups ? groups.filter(g => picked[g.dir]).length : 0;
  return (
    <Modal wide title="Qovluqdan yüklə" busy={busy} onClose={onClose}
      sub="DERSLER qovluğunu seçin. Hər Ders_XX qovluğundakı ORIGINAL, IZAH və TEST faylları bir dərs olur, BASLIQ.txt dərsin adıdır."
      footer={<>
        {groups && !finished && <span className="foot-note">{count} dərs seçilib</span>}
        <button className="btn" onClick={onClose} disabled={busy}>{finished ? 'Bağla' : 'Ləğv et'}</button>
        {groups && !finished && (
          <button className="btn primary" onClick={run} disabled={busy || !count}>
            {busy ? <><Loader2 size={15} className="spin" />Yüklənir</> : `${count} dərsi yüklə`}
          </button>
        )}
      </>}>
      {!groups && (
        <div className={`drop big ${over ? 'over' : ''}`}
          onClick={() => input.current?.click()}
          onDragOver={e => { e.preventDefault(); setOver(true); }}
          onDragLeave={() => setOver(false)}
          onDrop={async e => { e.preventDefault(); setOver(false); scan(await filesFromDrop(e.dataTransfer.items)); }}>
          {scanning ? <Loader2 size={24} className="spin" /> : <FolderOpen size={24} />}
          <span><b>DERSLER qovluğunu seçin</b> və ya bura sürüşdürün</span>
          <small>Faylların adı "_" ilə başlayırsa nəzərə alınmır. Eyni adlı Word və PDF varsa, PDF götürülür.</small>
          <input ref={input} type="file" hidden webkitdirectory="" directory="" multiple
            onChange={e => { scan(Array.from(e.target.files || [])); e.target.value = ''; }} />
        </div>
      )}

      {groups && (
        <div className="import-list">
          {!busy && !finished && (
            <div className="import-tools">
              <button className="link-btn" onClick={() => setPicked(Object.fromEntries(groups.map(g => [g.dir, true])))}>Hamısını seç</button>
              <button className="link-btn" onClick={() => setPicked(Object.fromEntries(groups.map(g => [g.dir, false])))}>Heç birini</button>
              <button className="link-btn" onClick={() => { setGroups(null); setPicked({}); }}>Başqa qovluq</button>
            </div>
          )}
          {groups.map(g => {
            const st = state[g.dir];
            const dup = existing.has(lower(g.title));
            const size = [...g.originals, g.explanation, g.test].filter(Boolean).reduce((a, f) => a + f.size, 0);
            return (
              <label key={g.dir} className={`import-row ${picked[g.dir] ? 'on' : ''}`}>
                <input type="checkbox" checked={!!picked[g.dir]} disabled={busy || finished}
                  onChange={e => setPicked(p => ({ ...p, [g.dir]: e.target.checked }))} />
                <div className="import-main">
                  <div className="import-title">
                    <span className="import-dir">{g.dir}</span>
                    <strong>{g.title}</strong>
                    {dup && <span className="meta-chip warn">Bu adda dərs artıq var</span>}
                  </div>
                  <div className="row-meta">
                    {g.originals.length > 0 && <span className="meta-chip"><FileText size={13} />{g.originals.length} normativ akt</span>}
                    {g.explanation && <span className="meta-chip"><BookOpen size={13} />İzah</span>}
                    {g.test && <span className="meta-chip"><ListChecks size={13} />Test</span>}
                    <span className="meta-chip muted">{fmtSize(size)}</span>
                  </div>
                  {(g.skipped.length > 0 || g.extraTests.length > 0 || g.extraExplanation.length > 0) && (
                    <div className="import-skip">
                      {g.skipped.length > 0 && <>PDF nüsxəsi olduğu üçün buraxıldı: {g.skipped.join(', ')}. </>}
                      {g.extraExplanation.length > 0 && <>Bir izah götürülür, qalanı buraxıldı: {g.extraExplanation.join(', ')}. </>}
                      {g.extraTests.length > 0 && <>Bir test faylı götürülür, qalanı buraxıldı: {g.extraTests.join(', ')}.</>}
                    </div>
                  )}
                  {st && (st.stage === 'upload' || st.stage === 'reading') && <Progress value={st.value} />}
                  {st?.note && <div className={`import-note ${st.stage}`}>{st.note}</div>}
                </div>
                <span className="import-state">
                  {!st && busy && picked[g.dir] && <Clock3 size={16} />}
                  {st && (st.stage === 'upload' || st.stage === 'reading') && <Loader2 size={16} className="spin" />}
                  {st?.stage === 'done' && <CheckCircle2 size={17} className="good" />}
                  {(st?.stage === 'warn' || st?.stage === 'error') && <AlertTriangle size={17} className="bad" />}
                </span>
              </label>
            );
          })}
        </div>
      )}
    </Modal>
  );
}
