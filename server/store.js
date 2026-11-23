// store.js — everything is kept on this server's disk (no database).
//
//   <DATA_DIR>/docs/*.json        the catalog and the test banks
//   <DATA_DIR>/files/*            the uploaded PDF / Word files
//   <DATA_DIR>/parts/*            pieces of uploads still on their way (≤ 3 MB each)
//
// DATA_DIR defaults to the "data" folder next to server.js.
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DATA = () => path.resolve(ROOT, process.env.DATA_DIR || 'data');
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');
const docPath = (id) => path.join(DATA(), 'docs', `${safe(id)}.json`);
const filePath = (name) => path.join(DATA(), 'files', safe(name));
const partPath = (key) => path.join(DATA(), 'parts', safe(key));

export function dataDir() { return DATA(); }
export async function ready() {
  for (const d of ['docs', 'files', 'parts']) await fs.mkdir(path.join(DATA(), d), { recursive: true });
}

// write to a temporary file first, then swap: a crash never leaves half a file
async function writeAtomic(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, p);
}
const gone = (e) => e && e.code === 'ENOENT';

/* ------------------------------ JSON ------------------------------ */
export async function getJson(id) {
  try { return { content: JSON.parse(await fs.readFile(docPath(id), 'utf8')) }; }
  catch (e) { if (gone(e)) return null; throw e; }
}
export async function putJson(id, content) {
  await writeAtomic(docPath(id), JSON.stringify(content, null, 1));
}
export async function deleteJson(id) {
  try { await fs.unlink(docPath(id)); } catch (e) { if (!gone(e)) throw e; }
}
// one change at a time, so two people saving at the same moment never lose each other's change
let chain = Promise.resolve();
export function updateJson(id, fallback, fn) {
  const run = chain.catch(() => {}).then(async () => {
    const cur = await getJson(id);
    const content = cur?.content ?? fallback();
    const next = (await fn(content)) || content;
    await putJson(id, next);
    return next;
  });
  chain = run;
  return run;
}

/* ------------------------------ files ------------------------------ */
export async function putFile(name, buf) { await writeAtomic(filePath(name), buf); }
export async function fileSize(name) {
  try { return (await fs.stat(filePath(name))).size; } catch (e) { if (gone(e)) return null; throw e; }
}
export async function fileRange(name, start, end) {
  let h;
  try { h = await fs.open(filePath(name), 'r'); } catch (e) { if (gone(e)) return null; throw e; }
  try {
    const size = (await h.stat()).size;
    const s = Math.min(start, size), e = Math.min(end, size);
    const buf = Buffer.alloc(Math.max(0, e - s));
    if (buf.length) await h.read(buf, 0, buf.length, s);
    return buf;
  } finally { await h.close(); }
}
export async function deleteFile(name) {
  try { await fs.unlink(filePath(name)); } catch (e) { if (!gone(e)) throw e; }
}

/* ------------------------------ upload parts ------------------------------ */
export const parts = {
  put: (key, buf) => writeAtomic(partPath(key), buf),
  get: async (key) => { try { return await fs.readFile(partPath(key)); } catch (e) { if (gone(e)) return null; throw e; } },
  drop: async (prefix) => {
    const p = safe(prefix);
    for (const n of await fs.readdir(path.join(DATA(), 'parts')).catch(() => [])) {
      if (n.startsWith(p)) await fs.rm(path.join(DATA(), 'parts', n), { force: true });
    }
  },
  // pieces of uploads that never finished (older than 6 hours)
  sweep: async () => {
    const dir = path.join(DATA(), 'parts');
    for (const n of await fs.readdir(dir).catch(() => [])) {
      try { const st = await fs.stat(path.join(dir, n)); if (Date.now() - st.mtimeMs > 6 * 3600e3) await fs.rm(path.join(dir, n), { force: true }); } catch { /* ignore */ }
    }
  }
};
