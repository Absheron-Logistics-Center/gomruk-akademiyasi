// Drop.jsx — a small menu that opens under a button and closes on any outside click.
import { useEffect, useRef, useState } from 'react';

export default function Drop({ button, className = '', title, align = 'left', children, disabled }) {
  const [open, setOpen] = useState(false);
  const box = useRef(null);
  useEffect(() => {
    if (!open) return;
    const off = (e) => { if (!box.current?.contains(e.target)) setOpen(false); };
    const key = (e) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('pointerdown', off);
    document.addEventListener('keydown', key);
    return () => { document.removeEventListener('pointerdown', off); document.removeEventListener('keydown', key); };
  }, [open]);
  return (
    <div className={`drop-wrap ${className}`} ref={box}>
      <button className={`drop-btn ${open ? 'open' : ''}`} title={title} disabled={disabled} onClick={() => setOpen(o => !o)} aria-expanded={open}>{button}</button>
      {open && (
        <div className={`drop-menu ${align}`} onClick={e => { if (e.target.closest('button')) setOpen(false); }}>
          {children}
        </div>
      )}
    </div>
  );
}
