// mirror.js — keeps a copy of everything on the Vercel site in this server's
// "data" folder. The server only makes outgoing requests (like a browser), so
// no port has to be opened in the router.
//
//   data/Dersler/01. <lesson>/Orijinal/<file>      the documents, with their real names
//   data/Dersler/01. <lesson>/Izah/<file>
//   data/Dersler/01. <lesson>/Test/<file>  +  suallar.json
//   data/Yekun sinaqlar/<exam>/...
//   data/catalog.json                              the lesson list as on the site
//   data/.cache/<doc id>.<ext>                     downloaded once, reused when a lesson is renamed or moved
//
// Something deleted on the site disappears from here on the next round (every minute).
import fs from 'fs/promises';
import path from 'path';

const sleep = (ms) => new Promise(r => setTimeout(r, ms));
const clean = (s, max = 110) => String(s || '')
  .replace(/[<>:"/\\|?*\u0000-\u001f]/g, ' ').replace(/\s+/g, ' ').trim()
  .slice(0, max).replace(/[. ]+$/, '') || 'adsiz';
const exists = (p) => fs.stat(p).then(s => s, () => null);

export function startMirror({ site, password, dataDir, every = 60 }) {
  const base = site.replace(/\/+$/, '');
  const state = { lastOk: null, lastError: null, files: 0, lessons: 0, running: false };
  let token = null;

  async function call(p, { raw = false } = {}) {
    for (let attempt = 0; attempt < 2; attempt++) {
      if (!token) {
        const r = await fetch(`${base}/api/login`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ username: 'Server', password })
        });
        const d = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(`Sayta daxil olmaq olmadı: ${d.error || r.status}`);
        token = d.token;
      }
      const r = await fetch(`${base}${p}`, { headers: { Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(60000) });
      if (r.status === 401) { token = null; continue; }
      if (!r.ok) {
        const d = await r.json().catch(() => ({}));
        throw new Error(`${p}: ${d.error || r.status}`);
      }
      return raw ? Buffer.from(await r.arrayBuffer()) : r.json();
    }
    throw new Error('Sayta daxil olmaq olmadı.');
  }

  async function download(doc, cacheFile) {
    const have = await exists(cacheFile);
    if (have && have.size === doc.size) return false;
    const parts = doc.parts || Math.max(1, Math.ceil(doc.size / (3 * 1024 * 1024)));
    const bufs = [];
    for (let n = 0; n < parts; n++) bufs.push(await call(`/api/gomruk/files/${encodeURIComponent(doc.id)}?part=${n}`, { raw: true }));
    const buf = Buffer.concat(bufs);
    if (buf.length !== doc.size) throw new Error(`${doc.name}: tam yüklənmədi`);
    await fs.mkdir(path.dirname(cacheFile), { recursive: true });
    await fs.writeFile(`${cacheFile}.tmp`, buf);
    await fs.rename(`${cacheFile}.tmp`, cacheFile);
    return true;
  }

  async function writeIfChanged(file, data) {
    const cur = await fs.readFile(file).catch(() => null);
    const buf = Buffer.isBuffer(data) ? data : Buffer.from(data);
    if (cur && cur.equals(buf)) return;
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, buf);
  }

  async function prune(dir, keep) {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) {
        await prune(p, keep);
        if (!(await fs.readdir(p)).length) await fs.rmdir(p).catch(() => {});
      } else if (!keep.has(p)) await fs.rm(p, { force: true });
    }
  }

  async function round() {
    const cat = await call('/api/gomruk/catalog');
    const cache = path.join(dataDir, '.cache');
    const keepTree = new Set();
    const keepCache = new Set();
    let downloaded = 0;

    const place = async (doc, folder) => {
      const cacheFile = path.join(cache, `${doc.id}.${doc.ext}`);
      keepCache.add(cacheFile);
      if (await download(doc, cacheFile)) downloaded++;
      let target = path.join(folder, clean(doc.name, 150));
      // two files with the same name in one folder: keep both
      if (keepTree.has(target)) target = path.join(folder, `${doc.id}-${clean(doc.name, 140)}`);
      keepTree.add(target);
      const t = await exists(target);
      if (!t || t.size !== doc.size) {
        await fs.mkdir(folder, { recursive: true });
        await fs.copyFile(cacheFile, target);
      }
    };
    const placeTests = async (owner, folder) => {
      if (!owner.tests) return;
      if (owner.tests.source) await place(owner.tests.source, folder);
      const file = path.join(folder, 'suallar.json');
      keepTree.add(file);
      const stamp = path.join(cache, `tests-${owner.id}.stamp`);
      keepCache.add(stamp);
      const seen = await fs.readFile(stamp, 'utf8').catch(() => '');
      if (seen !== owner.tests.updatedAt || !(await exists(file))) {
        const t = await call(`/api/gomruk/tests/${encodeURIComponent(owner.id)}`);
        await writeIfChanged(file, JSON.stringify(t, null, 1));
        await fs.mkdir(cache, { recursive: true });
        await fs.writeFile(stamp, owner.tests.updatedAt || '');
      }
    };

    const lessonsDir = path.join(dataDir, 'Dersler');
    for (const [i, l] of cat.lessons.entries()) {
      const dir = path.join(lessonsDir, `${String(i + 1).padStart(2, '0')}. ${clean(l.title, 90)}`);
      for (const d of l.originals || []) await place(d, path.join(dir, 'Orijinal'));
      if (l.explanation) await place(l.explanation, path.join(dir, 'Izah'));
      await placeTests(l, path.join(dir, 'Test'));
    }
    const examsDir = path.join(dataDir, 'Yekun sinaqlar');
    for (const [i, e] of cat.exams.entries()) {
      if (!e.tests) continue;
      await placeTests(e, path.join(examsDir, `${i + 1}. ${clean(e.title, 90)}`));
    }

    await prune(lessonsDir, keepTree);
    await prune(examsDir, keepTree);
    await prune(cache, keepCache);
    await writeIfChanged(path.join(dataDir, 'catalog.json'), JSON.stringify(cat, null, 1));
    state.files = keepCache.size;
    state.lessons = cat.lessons.length;
    return downloaded;
  }

  (async () => {
    console.log(`Sync: ${base} -> ${dataDir} (every ${every} s)`);
    for (;;) {
      state.running = true;
      try {
        const n = await round();
        state.lastOk = new Date().toISOString(); state.lastError = null;
        if (n) console.log(`[sync] ${new Date().toLocaleTimeString()}  ${n} new file(s), ${state.lessons} lessons`);
      } catch (e) {
        if (state.lastError !== e.message) console.error(`[sync] ${e.message}`);
        state.lastError = e.message;
      }
      state.running = false;
      await sleep(every * 1000);
    }
  })();

  return state;
}
