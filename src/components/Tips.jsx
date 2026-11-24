// Tips.jsx — the site's own hover hints in place of the browser's grey title boxes.
// Every element with a title gets it: the title is moved aside while the page runs
// (kept as the accessible name), and a styled hint appears after a short pause.
import { useEffect, useRef, useState } from 'react';

const DELAY = 380;

export default function Tips() {
  const [tip, setTip] = useState(null);       // { text, x, y, below }
  const box = useRef(null);
  const state = useRef({ el: null, timer: 0 });

  useEffect(() => {
    const s = state.current;
    const hide = () => { clearTimeout(s.timer); s.el = null; setTip(null); };

    // take the title off so the browser does not show its own box
    const claim = (el) => {
      const t = el.getAttribute('title');
      if (t !== null) {
        if (t.trim()) {
          el.dataset.tip = t;
          if (!el.hasAttribute('aria-label') && !(el.textContent || '').trim()) el.setAttribute('aria-label', t);
        }
        el.removeAttribute('title');
      }
      return el.dataset.tip || '';
    };

    const over = (e) => {
      if (e.pointerType === 'touch') return;
      const el = e.target.closest?.('[title], [data-tip]');
      if (!el || el.tagName === 'IFRAME') { if (s.el && !s.el.contains(e.target)) hide(); return; }
      const text = claim(el);
      if (el === s.el) return;
      hide();
      if (!text) return;
      s.el = el;
      s.timer = setTimeout(() => {
        if (s.el !== el || !el.isConnected) return;
        const r = el.getBoundingClientRect();
        setTip({ text, cx: r.left + r.width / 2, top: r.top, bottom: r.bottom });
      }, DELAY);
    };
    const out = (e) => {
      if (s.el && (!e.relatedTarget || !s.el.contains(e.relatedTarget))) hide();
    };

    document.addEventListener('pointerover', over, true);
    document.addEventListener('pointerout', out, true);
    document.addEventListener('pointerdown', hide, true);
    document.addEventListener('keydown', hide, true);
    window.addEventListener('scroll', hide, true);
    window.addEventListener('blur', hide);
    return () => {
      document.removeEventListener('pointerover', over, true);
      document.removeEventListener('pointerout', out, true);
      document.removeEventListener('pointerdown', hide, true);
      document.removeEventListener('keydown', hide, true);
      window.removeEventListener('scroll', hide, true);
      window.removeEventListener('blur', hide);
      clearTimeout(s.timer);
    };
  }, []);

  // place it under the element, or above when there is no room, inside the window
  const [pos, setPos] = useState(null);
  useEffect(() => {
    if (!tip) { setPos(null); return; }
    const el = box.current;
    if (!el) return;
    const w = el.offsetWidth, h = el.offsetHeight, gap = 8, pad = 8;
    const below = tip.bottom + gap + h <= window.innerHeight - pad;
    const y = below ? tip.bottom + gap : tip.top - gap - h;
    const x = Math.max(pad, Math.min(window.innerWidth - pad - w, tip.cx - w / 2));
    setPos({ x, y, below, arrow: Math.max(10, Math.min(w - 10, tip.cx - x)) });
  }, [tip]);

  if (!tip) return null;
  return (
    <div ref={box} role="tooltip" className={`tip ${pos ? 'on' : ''} ${pos?.below === false ? 'up' : ''}`}
      style={pos ? { left: pos.x, top: pos.y, '--ax': `${pos.arrow}px` } : { left: -9999, top: -9999 }}>
      {tip.text}
    </div>
  );
}
