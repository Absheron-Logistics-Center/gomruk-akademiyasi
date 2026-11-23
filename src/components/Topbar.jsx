import { useEffect, useState } from 'react';
import { ChevronLeft, LogOut, Minus, Plus, UserRound } from 'lucide-react';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const fmtTime = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export default function Topbar({ user, logout, font, setFont, back, backLabel, crumb }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <div className="topbar">
      <div className="top-left">
        {back && (
          <button className="pill-chip back-chip" onClick={back}>
            <ChevronLeft size={16} /><span>{backLabel || 'Geri'}</span>
          </button>
        )}
        {crumb ? <div className="pill-chip crumb-chip hide-sm">{crumb}</div> : <>
          <div className="pill-chip hide-sm">{fmtTime(now)}</div>
          <div className="pill-chip hide-sm">{fmtDate(now)}</div>
        </>}
      </div>
      <div className="top-right">
        <div className="font-ctl" title="Mətn ölçüsü">
          <button onClick={() => setFont(f => Math.max(80, f - 10))} disabled={font <= 80} aria-label="Mətni kiçilt"><Minus size={14} /></button>
          <span>{font}%</span>
          <button onClick={() => setFont(f => Math.min(140, f + 10))} disabled={font >= 140} aria-label="Mətni böyüt"><Plus size={14} /></button>
        </div>
        <div className="pill-chip user-chip hide-sm"><UserRound size={15} /><span>{user?.name}</span></div>
        <button className="logout-btn" onClick={logout}>
          <LogOut size={16} /><span className="hide-xs">Çıxış</span>
        </button>
      </div>
    </div>
  );
}
