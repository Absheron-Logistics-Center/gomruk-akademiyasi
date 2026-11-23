// app.js — the site's API. It runs only on your own server (server.js);
// the Vercel site passes every /api request through to it (api/index.js).
//
// Sign-in: everyone types their name. If APP_PASSWORD is set, the shared
// password is asked too. Everyone who is signed in can add, change and delete.
import express from 'express';
import crypto from 'crypto';
import routes from './routes.js';
import fs from 'fs';
import path from 'path';
import { dataDir, ready } from './store.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '5mb' }));

const DAYS = 30;
// the key that signs sign-ins: APP_SECRET, or one made once and kept in data/secret.txt
let key = null;
function secret() {
  if (process.env.APP_SECRET) return process.env.APP_SECRET;
  if (key) return key;
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

ready().catch(e => console.error('[data]', e.message));
app.get('/api/health', (_req, res) => res.json({ ok: true }));
app.get('/api/config', (_req, res) => res.json({ passwordRequired: !!process.env.APP_PASSWORD, storage: true }));

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
app.use('/api/gomruk', requireAuth, routes);

app.use('/api', (req, res) => res.status(404).json({ error: 'Belə sorğu yoxdur.' }));
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  console.error('[api]', err);
  const status = err.status || (err.type === 'entity.too.large' ? 413 : 500);
  res.status(status).json({ error: status === 500 ? `Server xətası: ${err.message}` : err.message });
});

export default app;
