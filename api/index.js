// Vercel: every /api/... request of the site is passed to your own server,
// where the lessons and files are kept. Set its address in Vercel:
//   Settings -> Environment Variables -> GOMRUK_SERVER_URL = http://your-public-address:3000
// (add the path too if your web server forwards one, e.g. http://your-address/gomruk)
// Pieces are at most 3 MB, so Vercel's 4.5 MB limit is never reached.
export const config = { api: { bodyParser: false } };

const PASS_UP = ['authorization', 'content-type', 'x-file-name'];
const PASS_DOWN = ['content-type', 'cache-control', 'content-disposition'];

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', c => chunks.push(c)).on('end', () => resolve(Buffer.concat(chunks))).on('error', reject);
  });
}
function fail(res, status, error) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify({ error }));
}

export default async function handler(req, res) {
  const server = (process.env.GOMRUK_SERVER_URL || '').replace(/\/+$/, '');
  if (!server) return fail(res, 500, 'Serverin ünvanı təyin edilməyib: Vercel-də GOMRUK_SERVER_URL əlavə edin.');

  const headers = {};
  for (const h of PASS_UP) if (req.headers[h]) headers[h] = req.headers[h];
  const ip = String(req.headers['x-forwarded-for'] || req.socket?.remoteAddress || '').split(',')[0].trim();
  if (ip) headers['x-forwarded-for'] = ip;

  const hasBody = !['GET', 'HEAD'].includes(req.method);
  let up;
  try {
    up = await fetch(server + req.url, {
      method: req.method,
      headers,
      body: hasBody ? await readBody(req) : undefined,
      signal: AbortSignal.timeout(55000)
    });
  } catch (e) {
    return fail(res, 502, `Server cavab vermir (${server}). Serverin işlədiyini və internetdən açıq olduğunu yoxlayın.`);
  }
  res.statusCode = up.status;
  for (const h of PASS_DOWN) { const v = up.headers.get(h); if (v) res.setHeader(h, v); }
  res.end(Buffer.from(await up.arrayBuffer()));
}
