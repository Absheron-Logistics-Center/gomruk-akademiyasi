// pdfQueue.js — Word files become PDFs in the background, one at a time.
// A Word file is queued right after it is uploaded (from the file on this
// computer), or the first time someone opens a Word document that has no PDF
// yet. When the PDF is attached, the page reloads the lesson list and the
// reader switches to the PDF on its own.
import { api } from './api.js';
import { loadDoc, uploadPieces, cachePut } from './files.js';
import { isWordName } from './toPdf.js';
import { canLayout, canSaveLayout, makeLayout, isComputer, LAYOUT_V } from './docxLayout.js';

const jobs = [];             // { doc, file, state: 'waiting'|'working'|'done'|'failed', step, error }
const listeners = new Set();
const tried = new Set();     // doc ids already handled in this visit
let running = false;

let lastInput = Date.now();
export const noteActivity = () => { lastInput = Date.now(); };
for (const ev of ['pointerdown', 'pointermove', 'keydown', 'wheel', 'touchstart', 'scroll']) {
  window.addEventListener(ev, () => { lastInput = Date.now(); }, { passive: true, capture: true });
}
const emit = () => { for (const fn of listeners) fn(snapshot()); };
export const snapshot = () => jobs.filter(j => !j.silent).map(j => ({ id: j.doc.id, name: j.doc.name, state: j.state, step: j.step, error: j.error }));
export function subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }
export const isQueued = (docId) => jobs.some(j => j.doc.id === docId && (j.state === 'waiting' || j.state === 'working'));
export const jobOf = (docId) => jobs.find(j => j.doc.id === docId) || null;

// doc: the stored document; file: the Word file itself if it is on hand
export function queuePdf(doc, file) {
  if (!doc?.id || ['word', 'libreoffice'].includes(doc.pdf?.engine) || doc.layout?.v === LAYOUT_V || !isWordName(doc.name) || tried.has(doc.id)) return;
  tried.add(doc.id);
  jobs.push({ doc, file: file || null, state: 'waiting', step: '' });
  emit();
  run();
}

// Word files nobody has opened since they were added: lay them out quietly one by one
// while the site is open on a computer, so every document opens at once later
export function prepareInBackground(catalog) {
  if (!catalog || !canSaveLayout() || !isComputer()) return;
  for (const l of catalog.lessons || []) {
    for (const doc of [...(l.originals || []), ...(l.explanation ? [l.explanation] : [])]) {
      if (!doc?.id || ['word', 'libreoffice'].includes(doc.pdf?.engine) || doc.layout?.v === LAYOUT_V || !isWordName(doc.name) || tried.has(doc.id)) continue;
      tried.add(doc.id);
      jobs.push({ doc, file: null, state: 'waiting', step: '', silent: true });
    }
  }
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
      const job = jobs.find(j => j.state === 'waiting' && !j.silent) || jobs.find(j => j.state === 'waiting');
      if (!job) break;
      // quiet work waits until nobody is using the page (laying out a long file takes a few seconds)
      if (job.silent) { while (Date.now() - lastInput < 8000) await new Promise(r => setTimeout(r, 2000)); }
      job.state = 'working'; emit();
      try {
        const set = (step) => { job.step = step; emit(); };
        let file = job.file;
        if (!file) {
          set('Word faylı yüklənir');
          const blob = await loadDoc(job.doc);
          file = new File([blob], job.doc.name);
        }
        // a Word file that opens in its own layout needs no PDF copy: its pages are laid
        // out once here and saved, so it opens at once for everyone
        if (await canLayout(file)) {
          if (canSaveLayout() && isComputer() && job.doc.layout?.v !== LAYOUT_V) {
            set('Səhifələr hazırlanır');
            await new Promise(r => setTimeout(r, 30));
            const gz = await makeLayout(file);
            set('Saxlanılır');
            const up = await uploadPieces(gz, `${job.doc.name.replace(/\.[^.]+$/, '')}.html.gz`);
            await api.attachLayout(job.doc.id, { ...up, v: LAYOUT_V });
            cachePut(`${job.doc.id}:layout:${up.uploadId}`, gz).catch(() => {});
            job.state = 'done'; job.step = ''; emit();
            window.dispatchEvent(new CustomEvent('ga:changed'));
          } else {
            jobs.splice(jobs.indexOf(job), 1); emit();
          }
          continue;
        }
        // old .doc files and others: their PDF is made by Microsoft Word on the company
        // server, never here (a browser cannot keep the look of a Word file)
        jobs.splice(jobs.indexOf(job), 1); emit();
        continue;
      } catch (e) {
        if (job.silent) { jobs.splice(jobs.indexOf(job), 1); emit(); }
        else { job.state = 'failed'; job.error = e.message; emit(); }
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
  if (jobs.some(j => !j.silent && (j.state === 'waiting' || j.state === 'working'))) { e.preventDefault(); e.returnValue = ''; }
});
