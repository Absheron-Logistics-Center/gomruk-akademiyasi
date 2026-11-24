// msword.js — Word files turned into PDF by Microsoft itself (Word for the web, through
// Microsoft Graph), so the PDF looks exactly like the document in Word. Runs on Vercel:
// no Word on any computer is needed. Each file is converted once; the PDF is kept with
// the document and the site shows it in its own PDF viewer from then on.
//
// Settings (Vercel → Settings → Environment Variables):
//   MS_CLIENT_ID, MS_CLIENT_SECRET   an app registered at entra.microsoft.com
// The Microsoft account is connected once from the site (account menu → Microsoft hesabı).
import crypto from 'crypto';
import { getJson, putJson, deleteJson, putPiece } from './store.js';

const LOGIN = 'https://login.microsoftonline.com/common/oauth2/v2.0';
const GRAPH = 'https://graph.microsoft.com/v1.0';
const SCOPE = 'offline_access User.Read Files.ReadWrite';
const FOLDER = 'Gomruk Akademiyasi (PDF)';
const TOKEN = 'ms/account';
const PART = 3 * 1024 * 1024;

export const msConfigured = () => !!(process.env.MS_CLIENT_ID && process.env.MS_CLIENT_SECRET);
const fail = (status, message, extra) => Object.assign(new Error(message), { status, ...extra });

export function redirectUri(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '').split(',')[0].trim();
  return `${proto}://${host}/api/ms/callback`;
}

export function loginUrl(redirect, state) {
  const q = new URLSearchParams({
    client_id: process.env.MS_CLIENT_ID, response_type: 'code', redirect_uri: redirect,
    response_mode: 'query', scope: SCOPE, state, prompt: 'select_account'
  });
  return `${LOGIN}/authorize?${q}`;
}

async function tokenCall(params) {
  const r = await fetch(`${LOGIN}/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: process.env.MS_CLIENT_ID, client_secret: process.env.MS_CLIENT_SECRET, scope: SCOPE, ...params })
  });
  const d = await r.json().catch(() => ({}));
  if (!r.ok || !d.access_token) throw fail(502, `Microsoft girişi alınmadı: ${d.error_description?.split('\n')[0] || d.error || r.status}`);
  return d;
}

let cached = null;   // { access, until }
export async function connect(code, redirect) {
  const t = await tokenCall({ grant_type: 'authorization_code', code, redirect_uri: redirect });
  const me = await fetch(`${GRAPH}/me`, { headers: { Authorization: `Bearer ${t.access_token}` } }).then(r => r.json()).catch(() => ({}));
  await putJson(TOKEN, { refresh: t.refresh_token, name: me.displayName || '', email: me.userPrincipalName || me.mail || '', at: new Date().toISOString() });
  cached = { access: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
}
export async function account() {
  const a = (await getJson(TOKEN))?.content;
  return a?.refresh ? { name: a.name, email: a.email, at: a.at } : null;
}
export async function disconnect() { cached = null; await deleteJson(TOKEN); }

async function access() {
  if (cached && cached.until > Date.now()) return cached.access;
  const a = (await getJson(TOKEN))?.content;
  if (!a?.refresh) throw fail(409, 'Microsoft hesabı qoşulmayıb.', { need: 'connect' });
  let t;
  try { t = await tokenCall({ grant_type: 'refresh_token', refresh_token: a.refresh }); }
  catch (e) { throw fail(409, `Microsoft hesabını yenidən qoşun. (${e.message})`, { need: 'connect' }); }
  if (t.refresh_token && t.refresh_token !== a.refresh) await putJson(TOKEN, { ...a, refresh: t.refresh_token });
  cached = { access: t.access_token, until: Date.now() + (t.expires_in - 120) * 1000 };
  return cached.access;
}

async function graph(method, path, { body, headers = {}, redirect = 'follow' } = {}) {
  const token = await access();
  return fetch(path.startsWith('http') ? path : `${GRAPH}${path}`, { method, body, redirect, headers: { Authorization: `Bearer ${token}`, ...headers } });
}
async function graphError(r, what) {
  const d = await r.json().catch(() => ({}));
  return fail(502, `${what}: ${d.error?.message || r.status}`);
}

// the real kind of a Word file (many ".doc" files are .docx inside)
function kindOf(buf, ext) {
  if (buf[0] === 0x50 && buf[1] === 0x4b) return 'docx';
  if (buf[0] === 0xd0 && buf[1] === 0xcf) return 'doc';
  if (buf.subarray(0, 5).toString('latin1') === '{\\rtf') return 'rtf';
  return ext || 'docx';
}

async function upload(buf, name) {
  const at = `/me/drive/root:/${encodeURIComponent(FOLDER)}/${encodeURIComponent(name)}:`;
  if (buf.length <= 4 * 1024 * 1024) {
    const r = await graph('PUT', `${at}/content?@microsoft.graph.conflictBehavior=replace`, { body: buf, headers: { 'Content-Type': 'application/octet-stream' } });
    if (!r.ok) throw await graphError(r, 'Fayl Microsoft-a göndərilmədi');
    return (await r.json()).id;
  }
  const s = await graph('POST', `${at}/createUploadSession`, {
    body: JSON.stringify({ item: { '@microsoft.graph.conflictBehavior': 'replace' } }), headers: { 'Content-Type': 'application/json' }
  });
  if (!s.ok) throw await graphError(s, 'Fayl Microsoft-a göndərilmədi');
  const { uploadUrl } = await s.json();
  const CH = 320 * 1024 * 16;   // 5 MB, a multiple of 320 KB as Graph asks
  let last = null;
  for (let from = 0; from < buf.length; from += CH) {
    const part = buf.subarray(from, Math.min(buf.length, from + CH));
    // the upload address carries its own permission: no Authorization header
    last = await fetch(uploadUrl, { method: 'PUT', body: part, headers: { 'Content-Range': `bytes ${from}-${from + part.length - 1}/${buf.length}`, 'Content-Length': String(part.length) } });
    if (!last.ok) throw await graphError(last, 'Fayl Microsoft-a göndərilmədi');
  }
  return (await last.json()).id;
}

async function pdfOf(itemId) {
  for (let i = 0; i < 3; i++) {
    const r = await graph('GET', `/me/drive/items/${itemId}/content?format=pdf`, { redirect: 'manual' });
    if (r.status === 302 || r.status === 301) {
      const p = await fetch(r.headers.get('location'));
      if (p.ok) return Buffer.from(await p.arrayBuffer());
      if (p.status !== 404 && p.status !== 503) throw fail(502, `PDF alınmadı (${p.status})`);
    } else if (r.ok) {
      return Buffer.from(await r.arrayBuffer());
    } else if (r.status !== 404 && r.status !== 503 && r.status !== 429) {
      throw await graphError(r, 'Word faylı PDF-ə çevrilmədi');
    }
    await new Promise(res => setTimeout(res, 1500 * (i + 1)));
  }
  throw fail(502, 'Microsoft PDF-i hazırlaya bilmədi. Bir az sonra yenidən cəhd edin.');
}

// Word bytes -> PDF bytes. The copy on OneDrive is deleted again afterwards.
export async function wordToPdf(docId, buf, ext) {
  const name = `${docId}.${kindOf(buf, ext)}`;
  // a call cut short by the time limit leaves the file uploaded: the next call goes on from there
  const saved = (await getJson(`ms/item/${docId}`))?.content;
  let id = saved?.id;
  if (!id) {
    id = await upload(buf, name);
    await putJson(`ms/item/${docId}`, { id }, { ttlSec: 3600 });
  }
  try {
    const pdf = await pdfOf(id);
    if (pdf.subarray(0, 5).toString('latin1') !== '%PDF-') throw fail(502, 'Microsoft-dan gələn fayl PDF deyil.');
    await graph('DELETE', `/me/drive/items/${id}`).catch(() => {});
    await deleteJson(`ms/item/${docId}`).catch(() => {});
    return pdf;
  } catch (e) {
    if (/itemNotFound|404/.test(e.message)) await deleteJson(`ms/item/${docId}`).catch(() => {});
    throw e;
  }
}

// keep a PDF the way every file is kept (3 MB pieces); returns the copy record
export async function storePdf(pdf) {
  const key = `u${Date.now().toString(36)}${crypto.randomBytes(3).toString('hex')}`;
  const parts = Math.max(1, Math.ceil(pdf.length / PART));
  const urls = [];
  for (let n = 0; n < parts; n++) urls.push(await putPiece(key, n, pdf.subarray(n * PART, (n + 1) * PART)));
  return { key, parts, size: pdf.length, ...(urls.every(Boolean) ? { urls } : {}), madeAt: new Date().toISOString(), engine: 'msword' };
}
