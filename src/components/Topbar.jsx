import { useEffect, useState } from 'react';
import { ChevronLeft, LogOut, UserRound, PanelLeftOpen } from 'lucide-react';

const MONTHS = ['yanvar', 'fevral', 'mart', 'aprel', 'may', 'iyun', 'iyul', 'avqust', 'sentyabr', 'oktyabr', 'noyabr', 'dekabr'];
const fmtTime = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const fmtDate = d => `${d.getDate()} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;

export default function Topbar({ user, logout, back, backLabel, crumb, onMenu, title, subtitle, tools }) {
  const [now, setNow] = useState(() => new Date());
  useEffect(() => { const t = setInterval(() => setNow(new Date()), 15000); return () => clearInterval(t); }, []);
  return (
    <div className="topbar">
      <div className="top-left">
        {onMenu && <button className="icon-btn ws-menu-btn" onClick={onMenu} aria-label="Dərslərin siyahısı"><PanelLeftOpen size={18} /></button>}
        {back && (
          <button className="pill-chip back-chip" onClick={back}>
            <ChevronLeft size={16} /><span>{backLabel || 'Geri'}</span>
          </button>
        )}
        {title ? (
          <div className="tb-title">
            <div className="tb-text">
              {subtitle && <span className="tb-sub">{subtitle}</span>}
              <strong title={title}>{title}</strong>
            </div>
            {tools && <div className="tb-tools">{tools}</div>}
          </div>
        ) : crumb ? <div className="pill-chip crumb-chip hide-sm">{crumb}</div> : <>
          <div className="pill-chip hide-sm">{fmtTime(now)}</div>
          <div className="pill-chip hide-sm">{fmtDate(now)}</div>
        </>}
      </div>
      <div className="top-right">
        <div className="pill-chip user-chip hide-sm"><UserRound size={15} /><span>{user?.name}</span></div>
        <button className="logout-btn" onClick={logout}>
          <LogOut size={16} /><span className="hide-xs">Çıxış</span>
        </button>
      </div>
    </div>
  );
}
