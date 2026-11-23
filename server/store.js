// store.js — where lessons and files are kept.
//
// On Vercel (both stores connected in Vercel → Storage):
//   lesson list + test banks  → Upstash Redis (free: 500,000 commands a month)
//   PDF / Word files          → Vercel Blob, private (each file kept in 3 MB pieces)
// Without those settings (your own computer / server, `npm start`):
//   everything goes to the "data" folder on disk.
//
// Files are kept in the same 3 MB pieces they are uploaded and downloaded in,
// so no step ever holds more than 3 MB (Vercel's limit for one request is 4.5 MB).
import fs from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { fileURLToPath } from 'url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
export const dataDir = () => path.resolve(ROOT, process.env.DATA_DIR || 'data');
const REDIS_URL = () => process.env.UPSTASH_REDIS_REST_URL || process.env.KV_REST_API_URL || '';
const REDIS_TOKEN = () => process.env.UPSTASH_REDIS_REST_TOKEN || process.env.KV_REST_API_TOKEN || '';
const BLOB_TOKEN = () => process.env.BLOB_READ_WRITE_TOKEN || '';
const onVercel = () => !!(process.env.VERCEL || process.env.VERCEL_ENV);

export const useRedis = () => !!(REDIS_URL() && REDIS_TOKEN());
export const useBlob = () => !!BLOB_TOKEN();
export function storageProblem() {
  if (!onVercel()) return '';
  const miss = [];
  if (!useRedis()) miss.push('Upstash Redis');
  if (!useBlob()) miss.push('Blob');
  return miss.length ? `Vercel → Storage bölməsində ${miss.join(' və ')} yaddaşını yaradıb bu layihəyə qoşun, sonra Redeploy edin.` : '';
}
const notReady = () => Object.assign(new Error(storageProblem()), { status: 503 });
const gone = (e) => e && e.code === 'ENOENT';
const safe = (s) => String(s).replace(/[^a-zA-Z0-9._-]/g, '_');

/* ============================== JSON ============================== */
let redisP = null;
async function redis() {
  if (!redisP) {
    redisP = import('@upstash/redis').then(({ Redis }) => new Redis({
      url: REDIS_URL(), token: REDIS_TOKEN(), automaticDeserialization: false, enableAutoPipelining: false
    }));
  }
  return redisP;
}
const KEY = (id) => `gomruk:${id}`;

async function diskWrite(p, data) {
  await fs.mkdir(path.dirname(p), { recursive: true });
  const tmp = `${p}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`;
  await fs.writeFile(tmp, data);
  await fs.rename(tmp, p);
}
const docPath = (id) => path.join(dataDir(), 'docs', `${safe(id)}.json`);

export async function getJson(id) {
  if (storageProblem()) throw notReady();
  if (useRedis()) {
    const v = await (await redis()).get(KEY(id));
    return v == null ? null : { content: JSON.parse(v) };
  }
  try { return { content: JSON.parse(await fs.readFile(docPath(id), 'utf8')) }; }
  catch (e) { if (gone(e)) return null; throw e; }
}
export async function putJson(id, content, { ttlSec } = {}) {
  if (storageProblem()) throw notReady();
  const text = JSON.stringify(content);
  if (useRedis()) {
    const r = await redis();
    await (ttlSec ? r.set(KEY(id), text, { ex: ttlSec }) : r.set(KEY(id), text));
    return;
  }
  await diskWrite(docPath(id), text);
}
export async function deleteJson(id) {
  if (useRedis()) { await (await redis()).del(KEY(id)); return; }
  try { await fs.unlink(docPath(id)); } catch (e) { if (!gone(e)) throw e; }
}

// Change a JSON document so that two people saving at the same moment never
// lose each other's change (a short lock in Redis; a queue on disk).
let chain = Promise.resolve();
export async function updateJson(id, fallback, fn) {
  if (storageProblem()) throw notReady();
  if (!useRedis()) {
    const run = chain.catch(() => {}).then(async () => {
      const cur = await getJson(id);
      const next = (await fn(cur?.content ?? fallback())) || cur?.content;
      await putJson(id, next);
      return next;
    });
    chain = run;
    return run;
  }
  const r = await redis();
  const lock = KEY(`lock:${id}`);
  const me = crypto.randomBytes(8).toString('hex');
  for (let i = 0; i < 60; i++) {
    if (await r.set(lock, me, { nx: true, px: 15000 })) {
      try {
        const cur = await getJson(id);
        const next = (await fn(cur?.content ?? fallback())) || cur?.content;
        await putJson(id, next);
        return next;
      } finally {
        if ((await r.get(lock)) === me) await r.del(lock);
      }
    }
    await new Promise(res => setTimeout(res, 80 + Math.random() * 170));
  }
  throw Object.assign(new Error('Eyni anda çox dəyişiklik oldu. Yenidən cəhd edin.'), { status: 409 });
}

/* ============================== files (in pieces) ============================== */
const piece = (key, n) => `gomruk/files/${safe(key)}/${String(n).padStart(3, '0')}`;
const piecePath = (key, n) => path.join(dataDir(), 'files', safe(key), String(n).padStart(3, '0'));

// returns the piece's address in Blob (null on disk)
export async function putPiece(key, n, buf) {
  if (storageProblem()) throw notReady();
  if (useBlob()) {
    const { put } = await import('@vercel/blob');
    const r = await put(piece(key, n), buf, {
      access: 'private', addRandomSuffix: false, allowOverwrite: true,
      contentType: 'application/octet-stream', cacheControlMaxAge: 31536000
    });
    return r.url || null;
  }
  await diskWrite(piecePath(key, n), buf);
  return null;
}

// url: the address put() gave back, if known
export async function getPiece(key, n, url) {
  if (useBlob()) {
    const { get } = await import('@vercel/blob');
    const r = await get(url || piece(key, n), { access: 'private' });
    if (!r || r.statusCode !== 200 || !r.stream) return null;
    return Buffer.from(await new Response(r.stream).arrayBuffer());
  }
  try { return await fs.readFile(piecePath(key, n)); } catch (e) { if (gone(e)) return null; throw e; }
}

export async function deletePieces(key, count, urls) {
  if (useBlob()) {
    const { del } = await import('@vercel/blob');
    const names = Array.isArray(urls) && urls.length ? urls : Array.from({ length: Math.max(1, count) }, (_, n) => piece(key, n));
    await del(names).catch(() => {});
    return;
  }
  await fs.rm(path.join(dataDir(), 'files', safe(key)), { recursive: true, force: true });
}
