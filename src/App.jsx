import { useCallback, useEffect, useRef, useState } from 'react';
import { api, getToken, getUser, clearSession, setOnExpired } from './lib/api.js';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import LessonPage from './components/LessonPage.jsx';
import ExamPage from './components/ExamPage.jsx';
import { useUi } from './components/ui.jsx';
import { go } from './lib/nav.js';
import PdfStatus from './components/PdfStatus.jsx';
import { prepareInBackground } from './lib/pdfQueue.js';

// #/                     lessons
// #/ders/<id>/<tab>      a lesson (tab: original | izah | test)
// #/sinaq/<id>           a final exam
function parseHash() {
  const h = decodeURIComponent(location.hash.replace(/^#\/?/, ''));
  const [kind, id, tab] = h.split('/');
  if (kind === 'ders' && id) return { page: 'lesson', id, tab: ['original', 'izah', 'test'].includes(tab) ? tab : null };
  if (kind === 'sinaq' && id) return { page: 'exam', id };
  return { page: 'home' };
}


export default function App() {
  const { toast } = useUi();
  const [user, setUser] = useState(() => (getToken() ? getUser() : null));
  const [route, setRoute] = useState(parseHash);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');

  useEffect(() => {
    const on = () => {
      setRoute(parseHash());
      const h = decodeURIComponent(location.hash.replace(/^#/, ''));
      if (/^\/(ders|sinaq)\//.test(h)) { try { localStorage.setItem('ga.last', h); } catch { /* private mode */ } }
    };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);


  const logout = useCallback(() => { clearSession(); setUser(null); setCatalog(null); go('/'); }, []);
  useEffect(() => { setOnExpired(() => { clearSession(); setUser(null); }); }, []);

  // the saved sign-in is checked once (account may have been disabled)
  useEffect(() => { if (user) api.me().catch(() => {}); }, [user]);

  const reload = useCallback(async () => {
    try {
      const c = await api.catalog();
      setCatalog(c); setLoadError('');
      return c;
    } catch (e) {
      setLoadError(e.message);
      return null;
    }
  }, []);

  // a Word file got its PDF: show it
  useEffect(() => {
    const on = () => reload();
    window.addEventListener('ga:changed', on);
    return () => window.removeEventListener('ga:changed', on);
  }, [reload]);

  useEffect(() => {
    if (!user) return;
    reload();
    // other people add and delete too: refresh now and then, and on return to the tab
    const t = setInterval(() => { if (document.visibilityState === 'visible') reload(); }, 45000);
    const v = () => { if (document.visibilityState === 'visible') reload(); };
    document.addEventListener('visibilitychange', v);
    return () => { clearInterval(t); document.removeEventListener('visibilitychange', v); };
  }, [user, reload]);

  // documents nobody has opened yet are prepared quietly, so they open at once later
  const prepared = useRef(false);
  useEffect(() => {
    if (!catalog || prepared.current) return;
    prepared.current = true;
    const t = setTimeout(() => prepareInBackground(catalog), 8000);
    return () => clearTimeout(t);
  }, [catalog]);

  if (!user) return <Login onLogin={u => { setUser(u); toast(`Xoş gəldiniz, ${u.name}`); }} />;

  const common = { user, catalog, reload, logout, loadError };

  // there is no separate main page: open the last lesson or exam, else the first lesson
  if (route.page === 'home' && catalog) {
    let last = null;
    try { last = localStorage.getItem('ga.last'); } catch { /* private mode */ }
    const ok = last && ((last.startsWith('/ders/') && catalog.lessons.some(l => last.startsWith(`/ders/${l.id}`)))
      || (last.startsWith('/sinaq/') && catalog.exams.some(e => last === `/sinaq/${e.id}`)));
    const target = ok ? last : catalog.lessons[0] ? `/ders/${catalog.lessons[0].id}` : null;
    if (target) { location.replace(`#${target}`); return null; }
  }
  let page;
  if (route.page === 'lesson') page = <LessonPage key={route.id} {...common} id={route.id} tab={route.tab} />;
  else if (route.page === 'exam') page = <ExamPage key={route.id} {...common} id={route.id} />;
  else page = <Home {...common} />;
  return <>{page}<PdfStatus /></>;
}
