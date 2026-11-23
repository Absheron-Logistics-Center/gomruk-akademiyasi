// routes.js — lessons, documents and test banks (mounted at /api/gomruk).
// Files go up and come down in parts of at most 3 MB: Vercel refuses request
// and response bodies over 4.5 MB.
import express, { Router } from 'express';
import crypto from 'crypto';
import { getJson, putJson, deleteJson, updateJson, putPiece, getPiece, deletePieces } from './store.js';

const router = Router();
const CATALOG = 'catalog';
const TESTS = id => `tests/${id}`;
const PART = 3 * 1024 * 1024;
const MAX_FILE = 95 * 1024 * 1024;
const EXAMS = 4;

const DOC_EXT = new Set(['pdf', 'doc', 'docx', 'docm', 'dot', 'dotx', 'dotm', 'rtf', 'odt', 'ott', 'xml', 'txt']);
const MIME = {
  pdf: 'application/pdf',
  doc: 'application/msword',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  rtf: 'application/rtf',
  odt: 'application/vnd.oasis.opendocument.text',
  txt: 'text/plain; charset=utf-8',
  xml: 'application/xml'
};

const uid = (p) => `${p}${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
const who = (req) => req.user?.name || req.user?.username || null;
const err = (status, message) => Object.assign(new Error(message), { status });
const wrap = fn => async (req, res, next) => {
  try { await fn(req, res); }
  catch (e) { if (e.status) return res.status(e.status).json({ error: e.message }); next(e); }
};
const extOf = n => (String(n || '').split('.').pop() || '').toLowerCase();

/* ------------------------------ catalog ------------------------------ */
function blankExams() {
  return Array.from({ length: EXAMS }, (_, i) => ({ id: `exam-${i + 1}`, title: `Yekun sınaq ${i + 1}`, tests: null, timeLimitMin: 0 }));
}
async function readCatalog() {
  const c = (await getJson(CATALOG))?.content || {};
  const exams = blankExams().map(e => ({ ...e, ...((c.exams || []).find(x => x.id === e.id) || {}) }));
  return { lessons: Array.isArray(c.lessons) ? c.lessons : [], exams, updatedAt: c.updatedAt || null };
}
// read, change and write the catalog without losing a change made at the same moment
async function updateCatalog(fn) {
  return updateJson(CATALOG, () => ({ lessons: [], exams: [] }), async (c) => {
    c.lessons = Array.isArray(c.lessons) ? c.lessons : [];
    c.exams = blankExams().map(e => ({ ...e, ...((c.exams || []).find(x => x.id === e.id) || {}) }));
    const out = (await fn(c)) || c;
    out.updatedAt = new Date().toISOString();
    return out;
  });
}
function owner(cat, id) {
  const l = cat.lessons.find(x => x.id === id);
  if (l) return { kind: 'lesson', item: l };
  const e = cat.exams.find(x => x.id === id);
  if (e) return { kind: 'exam', item: e };
  throw err(404, 'Dərs və ya sınaq tapılmadı.');
}
const docsOf = l => [...(l.originals || []), ...(l.explanation ? [l.explanation] : []), ...(l.tests?.source ? [l.tests.source] : [])];

// a document is kept as pieces of 3 MB under its upload key
const piecesOf = (d) => d.parts || Math.max(1, Math.ceil((d.size || 0) / PART));
async function dropDoc(doc) {
  if (!doc?.id) return;
  await deletePieces(doc.key || doc.id, piecesOf(doc), doc.urls).catch(() => {});
  if (doc.pdf?.key) await deletePieces(doc.pdf.key, doc.pdf.parts, doc.pdf.urls).catch(() => {});
}

/* ------------------------------ read ------------------------------ */
router.get('/catalog', wrap(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  // storage addresses stay on the server
  res.type('json').send(JSON.stringify(await readCatalog(), (k, v) => (k === 'urls' ? undefined : v)));
}));

router.get('/tests/:id', wrap(async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const t = (await getJson(TESTS(req.params.id)))?.content;
  if (!t) throw err(404, 'Test bankı tapılmadı.');
  res.json(t);
}));

/* ------------------------------ lessons ------------------------------ */
router.post('/lessons', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 250);
  if (!title) throw err(400, 'Dərsin adını yazın.');
  let made;
  await updateCatalog(c => {
    made = { id: uid('l'), title, originals: [], explanation: null, tests: null, createdAt: new Date().toISOString(), createdBy: who(req) };
    c.lessons.push(made);
  });
  res.status(201).json(made);
}));

router.put('/lessons/:id', wrap(async (req, res) => {
  const title = String(req.body?.title || '').trim().slice(0, 250);
  if (!title) throw err(400, 'Dərsin adını yazın.');
  let out;
  await updateCatalog(c => {
    const l = c.lessons.find(x => x.id === req.params.id);
    if (!l) throw err(404, 'Dərs tapılmadı.');
    l.title = title; l.updatedAt = new Date().toISOString(); l.updatedBy = who(req);
    out = l;
  });
  res.json(out);
}));

router.put('/exams/:id', wrap(async (req, res) => {
  let out;
  await updateCatalog(c => {
    const e = c.exams.find(x => x.id === req.params.id);
    if (!e) throw err(404, 'Sınaq tapılmadı.');
    if (req.body?.title !== undefined) e.title = String(req.body.title || '').trim().slice(0, 120) || e.title;
    if (req.body?.timeLimitMin !== undefined) e.timeLimitMin = Math.max(0, Math.min(600, Number(req.body.timeLimitMin) || 0));
    out = e;
  });
  res.json(out);
}));

// Deleting really deletes (on Vercel and, through the sync, on the server).
router.delete('/lessons/:id', wrap(async (req, res) => {
  let gone;
  await updateCatalog(c => {
    const i = c.lessons.findIndex(x => x.id === req.params.id);
    if (i < 0) throw err(404, 'Dərs tapılmadı.');
    gone = c.lessons.splice(i, 1)[0];
  });
  for (const d of docsOf(gone)) await dropDoc(d);
  if (gone.tests) await deleteJson(TESTS(gone.id)).catch(() => {});
  res.json({ ok: true });
}));

router.post('/reorder', wrap(async (req, res) => {
  const ids = Array.isArray(req.body?.ids) ? req.body.ids.map(String) : [];
  await updateCatalog(c => {
    const pos = new Map(ids.map((id, i) => [id, i]));
    c.lessons.sort((a, b) => (pos.get(a.id) ?? 1e9) - (pos.get(b.id) ?? 1e9));
  });
  res.json({ ok: true });
}));

/* ------------------------------ documents ------------------------------ */
// remove one document from a lesson: original (by doc id), explanation, or the test bank
router.delete('/lessons/:id/:section', wrap(async (req, res) => {
  const { id, section } = req.params;
  const docId = String(req.query.doc || '');
  let removed = [];
  let dropTests = false;
  await updateCatalog(c => {
    removed = []; dropTests = false;
    const { item } = owner(c, id);
    if (section === 'original') {
      const keep = [];
      for (const d of item.originals || []) (d.id === docId ? removed : keep).push(d);
      if (!removed.length) throw err(404, 'Sənəd tapılmadı.');
      item.originals = keep;
    } else if (section === 'explanation') {
      if (item.explanation) removed.push(item.explanation);
      item.explanation = null;
    } else if (section === 'tests') {
      if (item.tests?.source) removed.push(item.tests.source);
      item.tests = null;
      dropTests = true;
    } else throw err(400, 'Bölmə düz deyil.');
    item.updatedAt = new Date().toISOString(); item.updatedBy = who(req);
  });
  for (const d of removed) await dropDoc(d);
  if (dropTests) await deleteJson(TESTS(id)).catch(() => {});
  res.json({ ok: true });
}));

// the parsed test bank (the page reads the Word file and sends the questions)
router.put('/tests/:id', express.json({ limit: '4mb' }), wrap(async (req, res) => {
  const questions = Array.isArray(req.body?.questions) ? req.body.questions : null;
  if (!questions?.length) throw err(400, 'Sual tapılmadı.');
  if (questions.length > 3000) throw err(400, 'Çox sual var (maksimum 3000).');
  const id = req.params.id;
  // the Word file it was read from (uploaded just before as 'test-source')
  let source = null;
  if (req.body.sourceDocId) {
    source = (await getJson(`pending/${String(req.body.sourceDocId)}`))?.content || null;
    if (!source) throw err(400, 'Test faylı tapılmadı. Yenidən yükləyin.');
  }
  // the questions first, so the list never points at a test bank that is not there yet
  await putJson(TESTS(id), { questions, savedAt: new Date().toISOString(), by: who(req) });
  let old = null;
  await updateCatalog(c => {
    const { item } = owner(c, id);
    old = item.tests?.source || null;
    item.tests = { count: questions.length, source, updatedAt: new Date().toISOString(), by: who(req) };
    item.updatedAt = item.tests.updatedAt;
  });
  if (source) await deleteJson(`pending/${source.id}`).catch(() => {});
  if (old && old.id !== source?.id) await dropDoc(old);
  res.json({ ok: true, count: questions.length });
}));

/* ------------------------------ uploads in parts ------------------------------ */
// Each 3 MB piece is stored where it will stay; "finish" checks that every
// piece arrived and attaches the document to its lesson.
const UP_TTL = 6 * 3600;

router.post('/uploads', wrap(async (req, res) => {
  const name = String(req.body?.name || '').slice(0, 250);
  const size = Number(req.body?.size) || 0;
  const ext = extOf(name);
  if (!DOC_EXT.has(ext)) throw err(400, `Bu fayl növü qəbul edilmir: .${ext}`);
  if (size <= 0 || size > MAX_FILE) throw err(400, 'Faylın həcmi 95 MB-dan böyük ola bilməz.');
  res.json({ uploadId: uid('u'), partSize: PART, parts: Math.ceil(size / PART) });
}));

router.put('/uploads/:id/:n',
  express.raw({ type: () => true, limit: '3.5mb' }),
  wrap(async (req, res) => {
    const { id, n } = req.params;
    if (!/^u[a-z0-9]+$/i.test(id) || !/^\d{1,3}$/.test(n)) throw err(400, 'Yanlış hissə.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'Boş hissə.');
    if (req.body.length > PART) throw err(400, 'Hissə 3 MB-dan böyükdür.');
    const url = await putPiece(id, Number(n), req.body);
    await putJson(`up/${id}/${Number(n)}`, { size: req.body.length, url, head: Number(n) === 0 ? req.body.subarray(0, 8).toString('latin1') : '' }, { ttlSec: UP_TTL });
    res.json({ ok: true });
  })
);

// every piece of an upload arrived, in full
async function collectUpload(id, parts, size) {
  let total = 0, head = '';
  const urls = [];
  for (let i = 0; i < parts; i++) {
    const p = (await getJson(`up/${id}/${i}`))?.content;
    if (!p) throw err(400, `Faylın ${i + 1}-ci hissəsi çatmadı. Yenidən cəhd edin.`);
    total += p.size;
    if (p.url) urls.push(p.url);
    if (i === 0) head = p.head || '';
  }
  if (Number(size) && total !== Number(size)) throw err(400, 'Fayl tam yüklənmədi. Yenidən cəhd edin.');
  return { total, head, urls };
}

//   body: { name, size, parts, owner: lessonId|examId, section: 'original'|'explanation'|'test-source', replace?: docId }
router.post('/uploads/:id/finish', wrap(async (req, res) => {
  const { id } = req.params;
  if (!/^u[a-z0-9]+$/i.test(id)) throw err(400, 'Yanlış yükləmə.');
  const b = req.body || {};
  const name = String(b.name || '').slice(0, 250);
  const ext = extOf(name);
  if (!DOC_EXT.has(ext)) throw err(400, `Bu fayl növü qəbul edilmir: .${ext}`);
  const parts = Math.max(1, Math.min(40, Number(b.parts) || 1));
  const { total, head, urls } = await collectUpload(id, parts, b.size);
  if (ext === 'pdf' && !head.startsWith('%PDF-')) {
    await deletePieces(id, parts, urls);
    throw err(400, 'Bu fayl etibarlı PDF deyil.');
  }
  for (let i = 0; i < parts; i++) await deleteJson(`up/${id}/${i}`).catch(() => {});

  const doc = { id: uid('d'), key: id, parts, ...(urls.length === parts ? { urls } : {}), name, ext, size: total, uploadedAt: new Date().toISOString(), by: who(req) };
  const section = String(b.section || '');
  if (section === 'test-source') {
    // waits for PUT /tests/:id, which links it with the questions read from it
    await putJson(`pending/${doc.id}`, doc, { ttlSec: UP_TTL });
    return res.status(201).json(doc);
  }
  let removed = [];
  try {
    await updateCatalog(c => {
      removed = [];
      const { item, kind } = owner(c, String(b.owner || ''));
      if (kind !== 'lesson') throw err(400, 'Sınağa yalnız test faylı əlavə olunur.');
      if (section === 'original') {
        item.originals = item.originals || [];
        const at = b.replace ? item.originals.findIndex(x => x.id === b.replace) : -1;
        if (at >= 0) { removed.push(item.originals[at]); item.originals[at] = doc; } else item.originals.push(doc);
      } else if (section === 'explanation') {
        if (item.explanation) removed.push(item.explanation);
        item.explanation = doc;
      } else throw err(400, 'Bölmə düz deyil.');
      item.updatedAt = doc.uploadedAt; item.updatedBy = doc.by;
    });
  } catch (e) {
    await dropDoc(doc);
    throw e;
  }
  for (const d of removed) await dropDoc(d);
  res.status(201).json(doc);
}));

/* ------------------------------ PDF copy of a Word document ------------------------------ */
// The browser turns a Word file into a PDF and uploads it in pieces like any
// file; this attaches it to the Word document. The site then shows the PDF,
// the Word original stays for download.
//   body: { uploadId, parts, size }
router.post('/files/:docId/pdf', wrap(async (req, res) => {
  const docId = req.params.docId;
  const id = String(req.body?.uploadId || '');
  if (!/^u[a-z0-9]+$/i.test(id)) throw err(400, 'Yanlış yükləmə.');
  const parts = Math.max(1, Math.min(40, Number(req.body?.parts) || 1));
  const { total, head, urls } = await collectUpload(id, parts, req.body?.size);
  if (!head.startsWith('%PDF-')) { await deletePieces(id, parts, urls); throw err(400, 'PDF düzgün yaranmadı.'); }
  for (let i = 0; i < parts; i++) await deleteJson(`up/${id}/${i}`).catch(() => {});
  const pdf = { key: id, parts, size: total, ...(urls.length === parts ? { urls } : {}), madeAt: new Date().toISOString() };
  let old = null, found = false;
  await updateCatalog(c => {
    old = null; found = false;
    for (const o of [...c.lessons, ...c.exams]) {
      for (const d of docsOf(o)) {
        if (d.id !== docId) continue;
        found = true;
        old = d.pdf || null;
        d.pdf = pdf;
      }
    }
  });
  if (!found) { await deletePieces(id, parts, urls); throw err(404, 'Sənəd tapılmadı.'); }
  if (old?.key && old.key !== id) await deletePieces(old.key, old.parts, old.urls).catch(() => {});
  res.json({ ok: true, size: total });
}));

/* ------------------------------ downloads in parts ------------------------------ */
async function findDoc(docId) {
  const c = await readCatalog();
  for (const o of [...c.lessons, ...c.exams]) {
    for (const d of docsOf(o)) if (d.id === docId) return d;
  }
  return null;
}
// ?v=pdf: the PDF copy of a Word document
function variant(d, v) {
  if (v !== 'pdf') return d;
  if (!d.pdf) throw err(404, 'Bu sənədin PDF nüsxəsi hələ yoxdur.');
  return { ...d.pdf, id: d.id, name: `${String(d.name).replace(/\.[^.]+$/, '')}.pdf`, ext: 'pdf' };
}

router.get('/files/:docId/meta', wrap(async (req, res) => {
  const found = await findDoc(req.params.docId);
  if (!found) throw err(404, 'Sənəd tapılmadı.');
  const d = variant(found, req.query.v);
  const { urls: _hidden, pdf: _pdf, ...pub } = d;   // storage addresses stay on the server
  res.json({ ...pub, partSize: PART, mime: MIME[d.ext] || 'application/octet-stream' });
}));

router.get('/files/:docId', wrap(async (req, res) => {
  const found = await findDoc(req.params.docId);
  if (!found) throw err(404, 'Sənəd tapılmadı.');
  const d = variant(found, req.query.v);
  const part = Math.max(0, Math.floor(Number(req.query.part) || 0));
  if (part >= piecesOf(d)) throw err(404, 'Belə hissə yoxdur.');
  const buf = await getPiece(d.key || d.id, part, d.urls?.[part]);
  if (!buf) throw err(404, 'Sənədin faylı tapılmadı.');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');   // a doc id never changes content
  res.end(buf);
}));

export default router;
