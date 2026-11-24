// pdfQueue.js — Word files become exact PDFs once, made by Microsoft (Word for the web) on
// the server; the browser only asks for it and then shows the PDF in the site's own viewer.
// Files are done one after another, so nothing heavy ever runs in the browser.
import { api } from './api.js';

const EXACT = ['msword', 'word', 'libreoffice'];
export const hasExactPdf = (doc) => EXACT.includes(doc?.pdf?.engine);
const isWord = (doc) => doc && !/\.pdf$/i.test(doc.name || '') && doc.ext !== 'pdf';

/* ---- is a Microsoft account connected? (asked once, then remembered for the session) ---- */
let status = null, statusP = null;
export function msStatus(fresh) {
  if (fresh) { status = null; statusP = null; }
  if (status) return Promise.resolve(status);
  if (!statusP) {
    statusP = api.msStatus()
      .then(s => (status = { ...s, ready: !!(s.configured && s.account) }))
      .catch(() => (status = { configured: false, account: null, ready: false }))
      .finally(() => { statusP = null; });
  }
  return statusP;
}
export const msReadyNow = () => status?.ready;

/* ---- one document ---- */
const running = new Map();
const done = (pdf) => { window.dispatchEvent(new CustomEvent('ga:changed')); return pdf; };
// resolves with the PDF record; rejects with .need = 'connect' when no account is connected
export function makePdf(doc, again) {
  if (running.has(doc.id)) return running.get(doc.id);
  const p = api.makePdf(doc.id, again)
    .then(r => done(r.pdf))
    .catch(e => {
      if (e.status === 409 || /qoşulmayıb|yenidən qoşun/i.test(e.message)) { msStatus(true); e.need = 'connect'; }
      throw e;
    })
    .finally(() => running.delete(doc.id));
  running.set(doc.id, p);
  return p;
}

/* ---- many documents (after an upload, or "all" from the account menu) ---- */
const listeners = new Set();
let jobs = [];
const emit = () => { const s = snapshot(); for (const fn of listeners) fn(s); };
export const snapshot = () => jobs.map(j => ({ ...j }));
export function subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }
export const isQueued = (id) => jobs.some(j => j.id === id && (j.state === 'waiting' || j.state === 'working'));
export const jobOf = (id) => jobs.find(j => j.id === id) || null;
export const noteActivity = () => {};

let working = false;
async function work() {
  if (working) return;
  working = true;
  try {
    for (;;) {
      const j = jobs.find(x => x.state === 'waiting');
      if (!j) break;
      j.state = 'working'; j.step = 'Microsoft PDF hazırlayır'; emit();
      try { await makePdf(j.doc); j.state = 'done'; j.step = ''; }
      catch (e) {
        j.state = 'failed'; j.error = e.message;
        if (e.need === 'connect') { for (const x of jobs) if (x.state === 'waiting') { x.state = 'failed'; x.error = e.message; } }
      }
      emit();
    }
  } finally { working = false; }
  // finished lines go away after a while
  setTimeout(() => { jobs = jobs.filter(j => j.state !== 'done'); emit(); }, 6000);
}
function add(doc) {
  if (!isWord(doc) || hasExactPdf(doc) || isQueued(doc.id)) return;
  jobs = jobs.filter(j => j.id !== doc.id);
  jobs.push({ id: doc.id, name: doc.name, doc, state: 'waiting', step: '', error: '' });
}
// a Word file was just uploaded: make its PDF now, so it opens at once later
export async function queuePdf(doc) {
  if (!isWord(doc)) return;
  if (!(await msStatus()).ready) return;
  add(doc); emit(); work();
}
export function queueAll(docs) { for (const d of docs) add(d); emit(); work(); }
export function retryPdf(id) {
  const j = jobs.find(x => x.id === id);
  if (j) { j.state = 'waiting'; j.error = ''; emit(); work(); }
}

// the Word files people read (originals and explanations of every lesson)
export function wordDocs(catalog) {
  const out = [];
  for (const l of catalog?.lessons || []) for (const d of [...(l.originals || []), ...(l.explanation ? [l.explanation] : [])]) if (isWord(d)) out.push(d);
  return out;
}
export const waitingDocs = (catalog) => wordDocs(catalog).filter(d => !hasExactPdf(d));
