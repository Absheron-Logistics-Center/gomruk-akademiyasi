import { useCallback, useEffect, useState } from 'react';
import { api, getToken, getUser, clearSession, setOnExpired } from './lib/api.js';
import Login from './components/Login.jsx';
import Home from './components/Home.jsx';
import LessonPage from './components/LessonPage.jsx';
import ExamPage from './components/ExamPage.jsx';
import { useUi } from './components/ui.jsx';
import { go } from './lib/nav.js';
import PdfStatus from './components/PdfStatus.jsx';

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

const FONT_KEY = 'ga_font';

export default function App() {
  const { toast } = useUi();
  const [user, setUser] = useState(() => (getToken() ? getUser() : null));
  const [route, setRoute] = useState(parseHash);
  const [catalog, setCatalog] = useState(null);
  const [loadError, setLoadError] = useState('');
  const [font, setFont] = useState(() => { try { return Number(localStorage.getItem(FONT_KEY)) || 100; } catch { return 100; } });

  useEffect(() => {
    const on = () => { setRoute(parseHash()); };
    window.addEventListener('hashchange', on);
    return () => window.removeEventListener('hashchange', on);
  }, []);

  useEffect(() => {
    document.documentElement.style.setProperty('--font-scale', String(font / 100));
    try { localStorage.setItem(FONT_KEY, String(font)); } catch { /* ignore */ }
  }, [font]);

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

  if (!user) return <Login onLogin={u => { setUser(u); toast(`Xoş gəldiniz, ${u.name}`); }} />;

  const common = { user, catalog, reload, logout, font, setFont, loadError };
  let page;
  if (route.page === 'lesson') page = <LessonPage key={route.id} {...common} id={route.id} tab={route.tab} />;
  else if (route.page === 'exam') page = <ExamPage key={route.id} {...common} id={route.id} />;
  else page = <Home {...common} />;
  return <>{page}<PdfStatus /></>;
}
