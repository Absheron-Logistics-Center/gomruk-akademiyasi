// api.js — talks to the site's own API (api/index.js on Vercel, server.js on your own server).
const BASE = (import.meta.env.VITE_API_URL || '').replace(/\/$/, '');
const TOKEN_KEY = 'ga_token';
const USER_KEY = 'ga_user';

export function getToken() { try { return localStorage.getItem(TOKEN_KEY) || ''; } catch { return ''; } }
export function getUser() { try { return JSON.parse(localStorage.getItem(USER_KEY) || 'null'); } catch { return null; } }
function saveSession(token, user) {
  try { localStorage.setItem(TOKEN_KEY, token); localStorage.setItem(USER_KEY, JSON.stringify(user)); } catch { /* private mode */ }
}
export function clearSession() {
  try { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); } catch { /* ignore */ }
}

let onExpired = () => {};
export function setOnExpired(fn) { onExpired = fn; }

async function call(method, path, body, { raw = false, signal } = {}) {
  const headers = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  let payload;
  if (body instanceof Blob || body instanceof ArrayBuffer) { payload = body; headers['Content-Type'] = 'application/octet-stream'; }
  else if (body !== undefined) { payload = JSON.stringify(body); headers['Content-Type'] = 'application/json'; }
  let res;
  try { res = await fetch(`${BASE}${path}`, { method, headers, body: payload, cache: 'no-store', signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('Serverə qoşulmaq olmadı. İnternet bağlantısını yoxlayın.');
  }
  if (res.status === 401 && path !== '/api/login') { onExpired(); throw new Error('Sessiyanın vaxtı bitib. Yenidən daxil olun.'); }
  if (raw && res.ok) return res;
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = null; }
  if (!res.ok) {
    const msg = (data && data.error) || (res.status === 413 ? 'Fayl çox böyükdür.' : `Sorğu alınmadı (${res.status})`);
    const err = new Error(msg); err.status = res.status; throw err;
  }
  return data;
}

export async function login(username, password) {
  const data = await call('POST', '/api/login', { username, password });
  const user = { username: data.username, name: data.name || data.username, role: data.role };
  saveSession(data.token, user);
  return user;
}

export const api = {
  me: () => call('GET', '/api/me'),
  config: () => call('GET', '/api/config'),
  catalog: () => call('GET', '/api/gomruk/catalog'),
  tests: (id) => call('GET', `/api/gomruk/tests/${encodeURIComponent(id)}`),
  addLesson: (title) => call('POST', '/api/gomruk/lessons', { title }),
  renameLesson: (id, title) => call('PUT', `/api/gomruk/lessons/${encodeURIComponent(id)}`, { title }),
  deleteLesson: (id) => call('DELETE', `/api/gomruk/lessons/${encodeURIComponent(id)}`),
  reorder: (ids) => call('POST', '/api/gomruk/reorder', { ids }),
  saveExam: (id, patch) => call('PUT', `/api/gomruk/exams/${encodeURIComponent(id)}`, patch),
  deleteSection: (id, section, docId) =>
    call('DELETE', `/api/gomruk/lessons/${encodeURIComponent(id)}/${section}${docId ? `?doc=${encodeURIComponent(docId)}` : ''}`),
  saveTests: (id, body) => call('PUT', `/api/gomruk/tests/${encodeURIComponent(id)}`, body),
  startUpload: (name, size) => call('POST', '/api/gomruk/uploads', { name, size }),
  uploadPart: (uploadId, n, blob) => call('PUT', `/api/gomruk/uploads/${uploadId}/${n}`, blob),
  finishUpload: (uploadId, body) => call('POST', `/api/gomruk/uploads/${uploadId}/finish`, body),
  fileMeta: (docId) => call('GET', `/api/gomruk/files/${encodeURIComponent(docId)}/meta`),
  filePart: (docId, n, signal) => call('GET', `/api/gomruk/files/${encodeURIComponent(docId)}?part=${n}`, undefined, { raw: true, signal })
};
