// routes.js — lessons, documents and test banks (mounted at /api/gomruk).
// Files go up and come down in parts of at most 3 MB: Vercel refuses request
// and response bodies over 4.5 MB.
import express, { Router } from 'express';
import crypto from 'crypto';
import { getJson, putJson, deleteJson, updateJson, putFile, fileSize, fileRange, deleteFile, parts as partFiles } from './store.js';

const router = Router();
const CATALOG = 'catalog';
const TESTS = id => `tests/${id}`;
const FILE = (id, ext) => `${id}.${ext}`;
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

async function dropDoc(doc) {
  if (!doc?.id) return;
  await deleteFile(FILE(doc.id, doc.ext)).catch(() => {});
}

/* ------------------------------ read ------------------------------ */
router.get('/catalog', wrap(async (_req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  res.json(await readCatalog());
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
  let old = null;
  await updateCatalog(c => {
    const { item } = owner(c, id);
    old = item.tests?.source || null;
    item.tests = {
      count: questions.length,
      source: req.body.sourceDocId ? { id: String(req.body.sourceDocId), name: String(req.body.sourceName || 'test.docx').slice(0, 250), ext: extOf(req.body.sourceName) || 'docx', size: Number(req.body.sourceSize) || 0 } : null,
      updatedAt: new Date().toISOString(), by: who(req)
    };
    item.updatedAt = item.tests.updatedAt;
  });
  await putJson(TESTS(id), { questions, savedAt: new Date().toISOString(), by: who(req) });
  if (old && old.id !== req.body.sourceDocId) await dropDoc(old);
  res.json({ ok: true, count: questions.length });
}));

/* ------------------------------ uploads in parts ------------------------------ */
// pieces of an upload wait on disk until the last one arrives
async function partStore() { return partFiles; }

router.post('/uploads', wrap(async (req, res) => {
  const name = String(req.body?.name || '').slice(0, 250);
  const size = Number(req.body?.size) || 0;
  const ext = extOf(name);
  if (!DOC_EXT.has(ext)) throw err(400, `Bu fayl növü qəbul edilmir: .${ext}`);
  if (size <= 0 || size > MAX_FILE) throw err(400, 'Faylın həcmi 95 MB-dan böyük ola bilməz.');
  const id = uid('u');
  // old unfinished uploads go away
  partFiles.sweep().catch(() => {});
  res.json({ uploadId: id, partSize: PART, parts: Math.ceil(size / PART) });
}));

router.put('/uploads/:id/:n',
  express.raw({ type: () => true, limit: '3.5mb' }),
  wrap(async (req, res) => {
    const { id, n } = req.params;
    if (!/^u[a-z0-9]+$/i.test(id) || !/^\d{1,3}$/.test(n)) throw err(400, 'Yanlış hissə.');
    if (!Buffer.isBuffer(req.body) || !req.body.length) throw err(400, 'Boş hissə.');
    await (await partStore()).put(`${id}:${n.padStart(3, '0')}`, req.body);
    res.json({ ok: true });
  })
);

// put the parts together and attach the file where it belongs
//   body: { name, size, parts, owner: lessonId|examId, section: 'original'|'explanation'|'test-source', replace?: docId }
router.post('/uploads/:id/finish', wrap(async (req, res) => {
  const { id } = req.params;
  const b = req.body || {};
  const name = String(b.name || '').slice(0, 250);
  const ext = extOf(name);
  const parts = Math.max(1, Math.min(40, Number(b.parts) || 1));
  const store = await partStore();
  const bufs = [];
  for (let i = 0; i < parts; i++) {
    const part = await store.get(`${id}:${String(i).padStart(3, '0')}`);
    if (!part) throw err(400, `Faylın ${i + 1}-ci hissəsi çatmadı. Yenidən cəhd edin.`);
    bufs.push(part);
  }
  const buf = Buffer.concat(bufs);
  if (Number(b.size) && buf.length !== Number(b.size)) throw err(400, 'Fayl tam yüklənmədi. Yenidən cəhd edin.');
  if (ext === 'pdf' && buf.subarray(0, 5).toString('latin1') !== '%PDF-') throw err(400, 'Bu fayl etibarlı PDF deyil.');

  const doc = { id: uid('d'), name, ext, size: buf.length, uploadedAt: new Date().toISOString(), by: who(req) };
  await putFile(FILE(doc.id, ext), buf);
  await store.drop(`${id}:`).catch(() => {});

  const section = String(b.section || '');
  let removed = [];
  if (section !== 'test-source') {
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
      await deleteFile(FILE(doc.id, ext)).catch(() => {});
      throw e;
    }
    for (const d of removed) await dropDoc(d);
  }
  // test-source: the file is kept; PUT /tests/:id links it with the parsed questions
  res.status(201).json(doc);
}));

/* ------------------------------ downloads in parts ------------------------------ */
async function findDoc(docId) {
  const c = await readCatalog();
  for (const o of [...c.lessons, ...c.exams]) {
    for (const d of docsOf(o)) if (d.id === docId) return d;
  }
  return null;
}

router.get('/files/:docId/meta', wrap(async (req, res) => {
  const d = await findDoc(req.params.docId);
  if (!d) throw err(404, 'Sənəd tapılmadı.');
  const size = await fileSize(FILE(d.id, d.ext));
  if (size == null) throw err(404, 'Sənədin faylı tapılmadı.');
  res.json({ ...d, size, partSize: PART, mime: MIME[d.ext] || 'application/octet-stream' });
}));

router.get('/files/:docId', wrap(async (req, res) => {
  const d = await findDoc(req.params.docId);
  if (!d) throw err(404, 'Sənəd tapılmadı.');
  const part = Math.max(0, Number(req.query.part) || 0);
  const start = part * PART;
  const buf = await fileRange(FILE(d.id, d.ext), start, start + PART);
  if (!buf) throw err(404, 'Sənədin faylı tapılmadı.');
  res.setHeader('Content-Type', 'application/octet-stream');
  res.setHeader('Cache-Control', 'private, max-age=31536000, immutable');   // a doc id never changes content
  res.end(buf);
}));

export default router;
