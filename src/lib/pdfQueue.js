// pdfQueue.js — Word files become PDFs in the background, one at a time.
// A Word file is queued right after it is uploaded (from the file on this
// computer), or the first time someone opens a Word document that has no PDF
// yet. When the PDF is attached, the page reloads the lesson list and the
// reader switches to the PDF on its own.
import { api } from './api.js';
import { loadDoc, uploadPieces, cachePut } from './files.js';
import { wordToPdf, isWordName } from './toPdf.js';

const jobs = [];             // { doc, file, state: 'waiting'|'working'|'done'|'failed', step, error }
const listeners = new Set();
const tried = new Set();     // doc ids already handled in this visit
let running = false;

const emit = () => { for (const fn of listeners) fn(snapshot()); };
export const snapshot = () => jobs.map(j => ({ id: j.doc.id, name: j.doc.name, state: j.state, step: j.step, error: j.error }));
export function subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }
export const isQueued = (docId) => jobs.some(j => j.doc.id === docId && (j.state === 'waiting' || j.state === 'working'));
export const jobOf = (docId) => jobs.find(j => j.doc.id === docId) || null;

// doc: the stored document; file: the Word file itself if it is on hand
export function queuePdf(doc, file) {
  if (!doc?.id || doc.pdf || !isWordName(doc.name) || tried.has(doc.id)) return;
  tried.add(doc.id);
  jobs.push({ doc, file: file || null, state: 'waiting', step: '' });
  emit();
  run();
}

export function retryPdf(docId) {
  const j = jobs.find(x => x.doc.id === docId && x.state === 'failed');
  if (!j) return;
  j.state = 'waiting'; j.error = ''; emit(); run();
}

async function run() {
  if (running) return;
  running = true;
  try {
    for (;;) {
      const job = jobs.find(j => j.state === 'waiting');
      if (!job) break;
      job.state = 'working'; emit();
      try {
        const set = (step) => { job.step = step; emit(); };
        let file = job.file;
        if (!file) {
          set('Word faylı yüklənir');
          const blob = await loadDoc(job.doc);
          file = new File([blob], job.doc.name);
        }
        const pdf = await wordToPdf(file, set, job.doc.id);
        set('PDF saxlanılır');
        const name = `${job.doc.name.replace(/\.[^.]+$/, '')}.pdf`;
        const up = await uploadPieces(pdf, name, p => set(`PDF saxlanılır ${Math.round(p * 100)}%`));
        await api.attachPdf(job.doc.id, up);
        cachePut(`${job.doc.id}:pdf`, pdf).catch(() => {});
        job.state = 'done'; job.step = ''; emit();
        window.dispatchEvent(new CustomEvent('ga:changed'));
      } catch (e) {
        job.state = 'failed'; job.error = e.message; emit();
      }
    }
  } finally {
    running = false;
    // finished jobs leave the list after a while
    setTimeout(() => {
      for (let i = jobs.length - 1; i >= 0; i--) if (jobs[i].state === 'done') jobs.splice(i, 1);
      emit();
    }, 6000);
  }
}

// a page is closing while PDFs are still being made: ask before leaving
window.addEventListener('beforeunload', (e) => {
  if (jobs.some(j => j.state === 'waiting' || j.state === 'working')) { e.preventDefault(); e.returnValue = ''; }
});
