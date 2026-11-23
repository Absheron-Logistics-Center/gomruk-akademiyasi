// files.js — documents go up and come down in parts of 3 MB (Vercel refuses
// bodies over 4.5 MB). Downloaded documents are kept in this browser
// (IndexedDB) so a lesson opens instantly the second time. A document id never
// changes content: replacing a file makes a new id.
import { api } from './api.js';

export const DOC_ACCEPT = '.pdf,.doc,.docx,.docm,.dot,.dotx,.dotm,.rtf,.odt,.ott,.xml,.txt';
export const TEST_ACCEPT = '.doc,.docx,.docm,.dot,.dotx,.dotm,.rtf,.odt,.ott,.xml,.txt';
export const MAX_FILE = 95 * 1024 * 1024;
const CACHE_LIMIT = 400 * 1024 * 1024;

export const extOf = (name) => (String(name || '').split('.').pop() || '').toLowerCase();
export const isPdf = (name) => extOf(name) === 'pdf';
export const stem = (name) => String(name || '').replace(/\.[a-z0-9]{2,5}$/i, '');

export function fmtSize(n) {
  if (!n && n !== 0) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(n < 10 * 1024 * 1024 ? 1 : 0)} MB`;
}

/* ------------------------------ upload ------------------------------ */
// target: { owner, section: 'original'|'explanation'|'test-source', replace? }
export async function uploadFile(file, target, onProgress) {
  if (file.size > MAX_FILE) throw new Error(`${file.name}: faylın həcmi 95 MB-dan böyükdür.`);
  if (!file.size) throw new Error(`${file.name}: fayl boşdur.`);
  const { uploadId, partSize, parts } = await api.startUpload(file.name, file.size);
  let sent = 0;
  onProgress?.(0);
  for (let n = 0; n < parts; n++) {
    const blob = file.slice(n * partSize, Math.min(file.size, (n + 1) * partSize));
    let tries = 0;
    for (;;) {
      try { await api.uploadPart(uploadId, n, blob); break; }
      catch (e) { if (++tries >= 3 || e.status === 400) throw e; await new Promise(r => setTimeout(r, 800 * tries)); }
    }
    sent += blob.size;
    onProgress?.(sent / file.size);
  }
  const doc = await api.finishUpload(uploadId, { name: file.name, size: file.size, parts, ...target });
  // the file we just sent is the file: keep it so it opens without downloading
  cachePut(doc.id, file).catch(() => {});
  return doc;
}

/* ------------------------------ download ------------------------------ */
const inflight = new Map();
export function loadDoc(doc, onProgress) {
  if (inflight.has(doc.id)) return inflight.get(doc.id);
  const p = (async () => {
    const cached = await cacheGet(doc.id).catch(() => null);
    if (cached) { onProgress?.(1); return cached; }
    const meta = await api.fileMeta(doc.id);
    const parts = Math.max(1, Math.ceil(meta.size / meta.partSize));
    const chunks = [];
    let got = 0;
    for (let n = 0; n < parts; n++) {
      const res = await api.filePart(doc.id, n);
      const b = await res.arrayBuffer();
      chunks.push(b);
      got += b.byteLength;
      onProgress?.(Math.min(1, got / meta.size));
    }
    const blob = new Blob(chunks, { type: meta.mime || 'application/octet-stream' });
    if (blob.size !== meta.size) throw new Error('Sənəd tam yüklənmədi. Yenidən cəhd edin.');
    cachePut(doc.id, blob).catch(() => {});
    return blob;
  })();
  inflight.set(doc.id, p);
  p.finally(() => inflight.delete(doc.id));
  return p;
}

export function saveBlob(blob, name) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name || 'sened';
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

/* ------------------------------ browser cache ------------------------------ */
let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) return reject(new Error('no idb'));
      const r = indexedDB.open('gomruk-akademiyasi', 1);
      r.onupgradeneeded = () => r.result.createObjectStore('docs');
      r.onsuccess = () => resolve(r.result);
      r.onerror = () => reject(r.error);
    }).catch(e => { dbp = null; throw e; });
  }
  return dbp;
}
function tx(mode, fn) {
  return db().then(d => new Promise((resolve, reject) => {
    const t = d.transaction('docs', mode);
    const out = fn(t.objectStore('docs'));
    t.oncomplete = () => resolve(out?.result ?? out);
    t.onerror = () => reject(t.error);
    t.onabort = () => reject(t.error);
  }));
}
async function cacheGet(id) {
  const rec = await tx('readonly', s => s.get(id));
  if (!rec?.blob) return null;
  tx('readwrite', s => s.put({ ...rec, at: Date.now() }, id)).catch(() => {});
  return rec.blob;
}
async function cachePut(id, blob) {
  if (blob.size > CACHE_LIMIT / 4) return;
  await tx('readwrite', s => s.put({ blob, size: blob.size, at: Date.now() }, id));
  // keep the cache under its limit: drop the least recently opened
  const all = [];
  await tx('readonly', s => {
    const c = s.openCursor();
    c.onsuccess = () => { const cur = c.result; if (cur) { all.push({ id: cur.key, size: cur.value.size || 0, at: cur.value.at || 0 }); cur.continue(); } };
    return c;
  });
  let total = all.reduce((a, x) => a + x.size, 0);
  all.sort((a, b) => a.at - b.at);
  for (const x of all) {
    if (total <= CACHE_LIMIT) break;
    await tx('readwrite', s => s.delete(x.id)).catch(() => {});
    total -= x.size;
  }
}
export function cacheDrop(id) { return tx('readwrite', s => s.delete(id)).catch(() => {}); }
