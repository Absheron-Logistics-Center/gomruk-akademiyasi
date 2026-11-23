// PdfStatus.jsx — a small note at the bottom left while Word files become PDFs.
import { useEffect, useState } from 'react';
import { Loader2, CheckCircle2, AlertTriangle, RotateCw, X } from 'lucide-react';
import { subscribe, retryPdf } from '../lib/pdfQueue.js';

export default function PdfStatus() {
  const [jobs, setJobs] = useState([]);
  const [hidden, setHidden] = useState(false);
  useEffect(() => subscribe(j => { setJobs(j); if (j.some(x => x.state !== 'done')) setHidden(false); }), []);
  if (!jobs.length || hidden) return null;
  const busy = jobs.filter(j => j.state === 'waiting' || j.state === 'working');
  const failed = jobs.filter(j => j.state === 'failed');
  const now = jobs.find(j => j.state === 'working');
  const done = jobs.filter(j => j.state === 'done').length;
  return (
    <div className="pdf-status" role="status">
      <div className="pdf-status-head">
        {busy.length ? <Loader2 size={15} className="spin" /> : failed.length ? <AlertTriangle size={15} className="bad" /> : <CheckCircle2 size={15} className="good" />}
        <strong>{busy.length ? `Word → PDF: ${done + 1} / ${done + busy.length + failed.length}` : failed.length ? 'Bəzi PDF-lər alınmadı' : 'PDF-lər hazırdır'}</strong>
        {!busy.length && <button onClick={() => setHidden(true)} aria-label="Bağla"><X size={14} /></button>}
      </div>
      {now && <div className="pdf-status-line"><span>{now.name}</span><em>{now.step}</em></div>}
      {failed.map(f => (
        <div key={f.id} className="pdf-status-line bad">
          <span title={f.error}>{f.name}: {f.error}</span>
          <button onClick={() => retryPdf(f.id)} title="Yenidən cəhd et"><RotateCw size={13} /></button>
        </div>
      ))}
    </div>
  );
}
