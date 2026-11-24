// app.js — the site's API. On Vercel it runs as a function (api/index.js);
// on your own computer / server through server.js.
//
// Sign-in: everyone types their name. If APP_PASSWORD is set, the shared
// password is asked too. Everyone who is signed in can add, change and delete.
import express from 'express';
import crypto from 'crypto';
import routes, { findDoc, readWhole, firstBytes, OPEN_MAX, MIME } from './routes.js';
import fs from 'fs';
import path from 'path';
import { dataDir, storageProblem, useRedis, useBlob } from './store.js';
import { msConfigured, redirectUri, loginUrl, connect, account, disconnect } from './msword.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const DAYS = 30;
// the key that signs sign-ins: APP_SECRET, or one made once and kept in data/secret.txt
let key = null;
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (key) return key;
  // Vercel has no disk to keep one on: made from the storage keys, which never change
  if (process.env.VERCEL || process.env.VERCEL_ENV) {
    key = crypto.createHash('sha256').update(`gomruk:${process.env.BLOB_READ_WRITE_TOKEN || ''}:${process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || ''}:${process.env.APP_PASSWORD || ''}`).digest('hex');
    return key;
  }
  const f = path.join(dataDir(), 'secret.txt');
  try { key = fs.readFileSync(f, 'utf8').trim(); } catch { /* first start */ }
  if (!key) {
    key = crypto.randomBytes(32).toString('hex');
    fs.mkdirSync(dataDir(), { recursive: true });
    fs.writeFileSync(f, key);
  }
  return key;
}
const b64 = s => Buffer.from(s).toString('base64url');
const sign = body => crypto.createHmac('sha256', secret()).update(body).digest('base64url');

function makeToken(name) {
  const body = b64(JSON.stringify({ name, exp: Date.now() + DAYS * 864e5 }));
  return `${body}.${sign(body)}`;
}
function readToken(t) {
  const [body, mac] = String(t || '').split('.');
  if (!body || !mac) return null;
  const want = sign(body);
  if (want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return null;
  try {
    const d = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    return d.exp > Date.now() ? d : null;
  } catch { return null; }
}
function sameText(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

app.get('/api/health', (_req, res) => res.json({ ok: true, storage: storageProblem() ? 'missing' : useRedis() && useBlob() ? 'vercel' : 'disk' }));
app.get('/api/config', (_req, res) => res.json({ passwordRequired: !!process.env.APP_PASSWORD, storage: !storageProblem(), problem: storageProblem() || null }));

// slow down password guessing: 10 wrong tries per address, then wait 10 minutes
const tries = new Map();
const who = (req) => String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();
app.post('/api/login', (req, res) => {
  const ip = who(req);
  const t = tries.get(ip);
  if (t && t.n >= 10 && Date.now() - t.at < 10 * 60e3) return res.status(429).json({ error: 'Çox səhv cəhd. 10 dəqiqə sonra yenidən yoxlayın.' });
  const name = String(req.body?.username || req.body?.name || '').trim().replace(/\s+/g, ' ');
  const password = String(req.body?.password || '');
  if (name.length < 2 || name.length > 60) return res.status(400).json({ error: 'Adınızı yazın (2-60 hərf).' });
  if (process.env.APP_PASSWORD && !sameText(password, process.env.APP_PASSWORD)) {
    const cur = t && Date.now() - t.at < 10 * 60e3 ? t : { n: 0 };
    tries.set(ip, { n: cur.n + 1, at: Date.now() });
    return res.status(401).json({ error: 'Şifrə yanlışdır.' });
  }
  tries.delete(ip);
  res.json({ token: makeToken(name), username: name, name });
});

function requireAuth(req, res, next) {
  const h = req.headers.authorization || '';
  const d = h.startsWith('Bearer ') ? readToken(h.slice(7)) : null;
  if (!d) return res.status(401).json({ error: 'Daxil olun.' });
  req.user = { username: d.name, name: d.name };
  next();
}

app.get('/api/me', requireAuth, (req, res) => res.json(req.user));

// Word files are shown by Microsoft's own Word viewer (Office Online), so they look exactly
// as in Word. The viewer reads the file from a signed link that works for two hours only.
const OPEN_HOURS = 2;
const openSig = (id, exp) => sign(`open:${id}:${exp}`);
app.get('/api/gomruk/files/:docId/share', requireAuth, async (req, res, next) => {
  try {
    const d = await findDoc(req.params.docId);
    if (!d) return res.status(404).json({ error: 'Sənəd tapılmadı.' });
    if ((d.size || 0) > OPEN_MAX) return res.status(413).json({ error: 'Fayl Word görünüşü üçün böyükdür.' });
    // many files named .doc are .docx inside: give the viewer the real kind
    let ext = d.ext;
    if (ext !== 'pdf') { const h = await firstBytes(d); if (h[0] === 0x50 && h[1] === 0x4b) ext = 'docx'; }
    const exp = Date.now() + OPEN_HOURS * 3600e3;
    res.json({ path: `/api/open/${encodeURIComponent(d.id)}/${exp}/${openSig(d.id, exp)}/document.${ext}` });
  } catch (e) { next(e); }
});
app.get('/api/open/:docId/:exp/:sig/:name', async (req, res, next) => {
  try {
    const { docId, exp, sig } = req.params;
    const want = openSig(docId, exp);
    if (!(Number(exp) > Date.now()) || want.length !== sig.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(sig))) {
      return res.status(403).json({ error: 'Link köhnədir.' });
    }
    const d = await findDoc(docId);
    if (!d) return res.status(404).json({ error: 'Sənəd tapılmadı.' });
    if ((d.size || 0) > OPEN_MAX) return res.status(413).json({ error: 'Fayl böyükdür.' });
    const buf = await readWhole(d);
    const ext = String(req.params.name).split('.').pop();
    res.setHeader('Content-Type', MIME[ext] || 'application/octet-stream');
    res.setHeader('Content-Length', String(buf.length));
    res.setHeader('Cache-Control', 'private, max-age=3600');
    res.end(buf);
  } catch (e) { next(e); }
});

// The Microsoft account that turns Word files into exact PDFs (see msword.js)
app.get('/api/gomruk/ms', requireAuth, async (req, res, next) => {
  try {
    res.json({ configured: msConfigured(), account: msConfigured() ? await account() : null, redirect: redirectUri(req) });
  } catch (e) { next(e); }
});
app.get('/api/gomruk/ms/login', requireAuth, (req, res) => {
  if (!msConfigured()) return res.status(400).json({ error: 'Vercel-də MS_CLIENT_ID və MS_CLIENT_SECRET yazılmayıb.' });
  const body = b64(JSON.stringify({ exp: Date.now() + 15 * 60e3, n: crypto.randomBytes(6).toString('hex') }));
  res.json({ url: loginUrl(redirectUri(req), `${body}.${sign(`ms:${body}`)}`) });
});
app.delete('/api/gomruk/ms', requireAuth, async (_req, res, next) => {
  try { await disconnect(); res.json({ ok: true }); } catch (e) { next(e); }
});
app.get('/api/ms/callback', async (req, res) => {
  const back = (q) => res.redirect(`/#/?ms=${q}`);
  try {
    const [body, mac] = String(req.query.state || '').split('.');
    const want = body ? sign(`ms:${body}`) : '';
    if (!body || !mac || want.length !== mac.length || !crypto.timingSafeEqual(Buffer.from(want), Buffer.from(mac))) return back('bad');
    if (!(JSON.parse(Buffer.from(body, 'base64url').toString('utf8')).exp > Date.now())) return back('bad');
    if (req.query.error || !req.query.code) return back('no');
    await connect(String(req.query.code), redirectUri(req));
    back('ok');
  } catch (e) {
    console.error('[ms]', e);
    back('fail');
  }
});

app.use('/api/gomruk', requireAuth, routes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Belə sorğu yoxdur.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  res.status(status).json({ error: status === 500 ? `Server xətası: ${err.message}` : err.message });
});

export default app;
