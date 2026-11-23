// Gömrük Akademiyası server: keeps every lesson, document and test on this
// computer's disk (the "data" folder) and answers the Vercel site.
//
//   npm install
//   npm start                  -> http://localhost:3000
//
// Settings: a ".env" file next to this one (see .env.example) or environment variables.
//   PORT          port to listen on (default 3000)
//   BASE_PATH     e.g. /gomruk when your web server forwards http://your-address/gomruk/... here
//   APP_PASSWORD  shared password for signing in (optional)
//   DATA_DIR      where files are kept (default: the "data" folder here)
//
// If "npm run build" was run (and BASE_PATH is empty), the site itself is also
// served here, so it works inside the company network even without Vercel.
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

const { default: app } = await import('./server/app.js');
const { dataDir } = await import('./server/store.js');

const base = (process.env.BASE_PATH || '').replace(/\/+$/, '');
const dist = path.join(here, 'dist');
const site = express();
site.set('trust proxy', true);
site.use(base || '/', app);
if (!base && fs.existsSync(path.join(dist, 'index.html'))) {
  site.use(express.static(dist, { maxAge: '7d', index: false }));
  site.get('*', (_req, res) => res.sendFile(path.join(dist, 'index.html')));
}

const port = Number(process.env.PORT) || 3000;
site.listen(port, '0.0.0.0', () => {
  console.log(`Gömrük Akademiyası server: http://localhost:${port}${base}`);
  console.log(`Data folder: ${dataDir()}`);
});
