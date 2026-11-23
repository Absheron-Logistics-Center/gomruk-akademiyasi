// Gömrük Akademiyası on your own server.
//
//   npm install
//   npm start
//
// Settings: a ".env" file next to this one (see .env.example).
//
// With SITE_URL (normal use):
//   keeps a copy of everything on the Vercel site in the "data" folder and
//   follows every change (added, renamed, deleted) once a minute. Only
//   outgoing connections are used, so nothing has to be opened in the router.
//   http://localhost:PORT shows when the last copy was made.
//
// Without SITE_URL:
//   runs the whole site here on its own (files in "data"), for use inside the
//   company network only. Run "npm run build" once first.
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';

const here = path.dirname(fileURLToPath(import.meta.url));
try {
  for (const line of fs.readFileSync(path.join(here, '.env'), 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/.exec(line);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
} catch { /* no .env file */ }

const port = Number(process.env.PORT) || 3000;
const dataDir = path.resolve(here, process.env.DATA_DIR || 'data');
const site = express();

if (process.env.SITE_URL) {
  const { startMirror } = await import('./server/mirror.js');
  const state = startMirror({ site: process.env.SITE_URL, password: process.env.APP_PASSWORD || '', dataDir, every: Number(process.env.SYNC_SECONDS) || 60 });
  site.get('/', (_req, res) => {
    res.type('html').send(`<!doctype html><meta charset="utf-8"><title>Gömrük Akademiyası server</title>
<body style="font:15px system-ui;padding:32px;color:#243f4f">
<h2>Gömrük Akademiyası: serverdəki nüsxə</h2>
<p>Sayt: <a href="${process.env.SITE_URL}">${process.env.SITE_URL}</a></p>
<p>Qovluq: ${dataDir}</p>
<p>Son yenilənmə: <b>${state.lastOk ? new Date(state.lastOk).toLocaleString() : 'hələ yoxdur'}</b></p>
<p>Dərslər: ${state.lessons} · Fayllar: ${state.files}</p>
${state.lastError ? `<p style="color:#dc2626">Xəta: ${state.lastError}</p>` : ''}
<script>setTimeout(()=>location.reload(),15000)</script></body>`);
  });
} else {
  const { default: app } = await import('./server/app.js');
  const dist = path.join(here, 'dist');
  site.set('trust proxy', true);
  site.use(app);
  if (fs.existsSync(path.join(dist, 'index.html'))) {
    site.use(express.static(dist, { maxAge: '7d', index: false }));
    site.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
  }
}

site.listen(port, '0.0.0.0', () => {
  console.log(`Gömrük Akademiyası server: http://localhost:${port}`);
  console.log(`Data folder: ${dataDir}`);
});
