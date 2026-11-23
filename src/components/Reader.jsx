// Reader.jsx — opens a stored document. PDF in the browser's own PDF viewer,
// Word / RTF / ODT / old .doc as a readable page with search, pages and zoom.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Download, ExternalLink, Search, MoveHorizontal,
  Loader2, AlertTriangle, ChevronUp, ChevronDown, X, RotateCw
} from 'lucide-react';
import { Progress } from './ui.jsx';
import { loadDoc, saveBlob, isPdf, fmtSize } from '../lib/files.js';
import { GACompat } from '../lib/gaParse.js';

const READER_CSS = `
  mark.ga-hit{background:#fde68a;color:inherit;border-radius:2px;padding:0 1px}
  mark.ga-hit.cur{background:#f59e0b;color:#fff;box-shadow:0 0 0 2px rgba(245,158,11,.35)}
  body{transition:none}
`;

export default function Reader({ doc, label, extra }) {
  const [blob, setBlob] = useState(null);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const panel = useRef(null);

  useEffect(() => {
    let alive = true;
    setBlob(null); setErr(''); setProgress(0);
    loadDoc(doc, p => alive && setProgress(p))
      .then(b => { if (alive) setBlob(b); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [doc.id, attempt]);   // eslint-disable-line react-hooks/exhaustive-deps

  const pdf = isPdf(doc.name);
  const fullscreen = () => {
    const el = panel.current;
    if (!el) return;
    if (document.fullscreenElement) document.exitFullscreen?.();
    else el.requestFullscreen?.();
  };

  return (
    <div className="reader" ref={panel}>
      {err ? (
        <div className="reader-state bad">
          <AlertTriangle size={22} />
          <strong>Sənəd açılmadı</strong>
          <span>{err}</span>
          <button className="btn small" onClick={() => setAttempt(a => a + 1)}><RotateCw size={14} />Yenidən cəhd et</button>
        </div>
      ) : !blob ? (
        <div className="reader-state">
          <Loader2 size={22} className="spin" />
          <strong>{label} yüklənir</strong>
          <span>{doc.name} · {fmtSize(doc.size)}</span>
          <div className="reader-progress"><Progress value={progress} /></div>
        </div>
      ) : pdf ? (
        <PdfView blob={blob} doc={doc} onFull={fullscreen} extra={extra} />
      ) : (
        <WordView blob={blob} doc={doc} onFull={fullscreen} extra={extra} />
      )}
    </div>
  );
}

function useObjectUrl(blob, type) {
  const [url, setUrl] = useState('');
  useEffect(() => {
    const u = URL.createObjectURL(type && blob.type !== type ? new Blob([blob], { type }) : blob);
    setUrl(u);
    return () => URL.revokeObjectURL(u);
  }, [blob, type]);
  return url;
}

/* ------------------------------ PDF ------------------------------ */
function PdfView({ blob, doc, onFull, extra }) {
  const url = useObjectUrl(blob, 'application/pdf');
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const [zoom, setZoom] = useState(100);
  const [fit, setFit] = useState(true);
  const frame = useRef(null);

  const frag = fit ? `#page=${page}&view=FitH` : `#page=${page}&zoom=${zoom}`;
  const src = url ? `${url}${frag}` : 'about:blank';
  // the viewer reads the part after # when the address changes
  useEffect(() => { if (frame.current && url && frame.current.src !== src) frame.current.src = src; }, [src, url]);

  const goPage = (n) => { const v = Math.max(1, Math.min(99999, Math.floor(Number(n) || 1))); setPage(v); setPageText(String(v)); };

  return (
    <>
      <div className="reader-bar">
        <div className="reader-name" title={doc.name}><span className="ftype pdf">PDF</span><span>{doc.name}</span></div>
        <div className="tool-group">
          <button className="tool" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronLeft size={16} /></button>
          <input className="page-input" value={pageText} inputMode="numeric" aria-label="Səhifə"
            onChange={e => setPageText(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') goPage(pageText); }} onBlur={() => goPage(pageText)} />
          <button className="tool" onClick={() => goPage(page + 1)} title="Növbəti səhifə"><ChevronRight size={16} /></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={() => { setFit(false); setZoom(z => Math.max(50, z - 25)); }} title="Kiçilt"><ZoomOut size={16} /></button>
          <span className="tool-label">{fit ? 'Eninə' : `${zoom}%`}</span>
          <button className="tool" onClick={() => { setFit(false); setZoom(z => Math.min(300, z + 25)); }} title="Böyüt"><ZoomIn size={16} /></button>
          <button className={`tool ${fit ? 'on' : ''}`} onClick={() => setFit(f => !f)} title="Eninə yerləşdir"><MoveHorizontal size={16} /></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={onFull} title="Tam ekran"><Maximize2 size={16} /></button>
          <a className="tool" href={url || undefined} target="_blank" rel="noopener" title="Yeni pəncərədə aç"><ExternalLink size={16} /></a>
          <button className="tool" onClick={() => saveBlob(blob, doc.name)} title="Endir"><Download size={16} /></button>
        </div>
        {extra}
      </div>
      <iframe ref={frame} className="reader-frame" title={doc.name} src={src} />
      <div className="reader-note">PDF görüntüsü rəngləri, cədvəlləri və tərtibatı olduğu kimi saxlayır. Mətndə axtarmaq üçün sənədin üzərinə klikləyib Ctrl+F basın.</div>
    </>
  );
}

/* ------------------------------ Word and others ------------------------------ */
function WordView({ blob, doc, onFull, extra }) {
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(() => Math.round(100 * (parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--font-scale')) || 1)));
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ n: 0, cur: -1 });
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const frame = useRef(null);
  const marks = useRef([]);

  useEffect(() => {
    let alive = true;
    setParsed(null); setErr('');
    const file = new File([blob], doc.name, { type: blob.type });
    GACompat.read(file, 'document')
      .then(r => { if (alive) setParsed(r); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [blob, doc.name]);

  const html = useMemo(() => parsed?.html?.replace('</head>', `<style>${READER_CSS}</style></head>`) || '', [parsed]);
  const docOf = () => frame.current?.contentDocument || null;

  const applyZoom = useCallback(() => {
    const d = docOf();
    if (d?.body) d.body.style.zoom = String(zoom / 100);
  }, [zoom]);
  useEffect(applyZoom, [applyZoom]);

  const onLoad = () => {
    const d = docOf();
    if (!d) return;
    applyZoom();
    setPages(d.querySelectorAll('div.docpage').length || 1);
    // track which page is on screen
    d.addEventListener('scroll', () => {
      const all = d.querySelectorAll('div.docpage');
      let cur = 1;
      all.forEach((p, i) => { if (p.getBoundingClientRect().top < 120) cur = i + 1; });
      setPage(cur);
    }, { passive: true });
    if (term) runSearch(term);
  };

  function clearMarks() {
    for (const m of marks.current) {
      const parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(m.ownerDocument.createTextNode(m.textContent), m);
      parent.normalize();
    }
    marks.current = [];
  }

  function runSearch(q) {
    const d = docOf();
    if (!d?.body) return;
    clearMarks();
    const needle = q.trim().toLocaleLowerCase('az');
    if (needle.length < 2) { setHits({ n: 0, cur: -1 }); return; }
    const walker = d.createTreeWalker(d.body, NodeFilter.SHOW_TEXT);
    const nodes = [];
    while (walker.nextNode()) nodes.push(walker.currentNode);
    const found = [];
    for (const node of nodes) {
      if (found.length >= 2000) break;
      const low = node.nodeValue.toLocaleLowerCase('az');
      if (low.length !== node.nodeValue.length) continue;   // lower-casing changed the length: offsets would drift
      const at = [];
      for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) at.push(i);
      if (!at.length) continue;
      // wrap from the end so the earlier offsets stay valid
      const here = [];
      for (let k = at.length - 1; k >= 0; k--) {
        const hit = node.splitText(at[k]);
        hit.splitText(needle.length);
        const m = d.createElement('mark');
        m.className = 'ga-hit';
        hit.parentNode.replaceChild(m, hit);
        m.appendChild(hit);
        here.unshift(m);
      }
      found.push(...here);
    }
    marks.current = found;
    setHits({ n: found.length, cur: found.length ? 0 : -1 });
    if (found.length) focusHit(0, found);
  }

  function focusHit(i, list = marks.current) {
    list.forEach(m => m.classList.remove('cur'));
    const m = list[i];
    if (!m) return;
    m.classList.add('cur');
    m.scrollIntoView({ block: 'center' });
  }
  const step = (dir) => {
    if (!hits.n) return;
    const i = (hits.cur + dir + hits.n) % hits.n;
    setHits(h => ({ ...h, cur: i }));
    focusHit(i);
  };

  // search as you type, a little after the last key
  useEffect(() => {
    if (!parsed) return;
    const t = setTimeout(() => runSearch(term), 250);
    return () => clearTimeout(t);
  }, [term, parsed]);   // eslint-disable-line react-hooks/exhaustive-deps

  const goPage = (n) => {
    const d = docOf();
    const v = Math.max(1, Math.min(pages, n));
    d?.getElementById(`page=${v}`)?.scrollIntoView({ block: 'start' });
    setPage(v);
  };

  if (err) {
    return (
      <div className="reader-state bad">
        <AlertTriangle size={22} />
        <strong>Sənədin mətni oxunmadı</strong>
        <span>{err}</span>
        <button className="btn small" onClick={() => saveBlob(blob, doc.name)}><Download size={14} />Orijinal faylı endir</button>
      </div>
    );
  }
  if (!parsed) {
    return <div className="reader-state"><Loader2 size={22} className="spin" /><strong>Sənəd hazırlanır</strong><span>{doc.name}</span></div>;
  }

  return (
    <>
      <div className="reader-bar">
        <div className="reader-name" title={doc.name}><span className="ftype word">{doc.ext?.toUpperCase() || 'DOC'}</span><span>{doc.name}</span></div>
        <div className="reader-search">
          <Search size={15} />
          <input value={term} placeholder="Mətndə axtar" onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setTerm(''); }} />
          {term.trim().length >= 2 && <span className="hit-count">{hits.n ? `${hits.cur + 1} / ${hits.n}` : 'Tapılmadı'}</span>}
          {term && <>
            <button className="tool sm" onClick={() => step(-1)} disabled={!hits.n} title="Əvvəlki"><ChevronUp size={15} /></button>
            <button className="tool sm" onClick={() => step(1)} disabled={!hits.n} title="Növbəti"><ChevronDown size={15} /></button>
            <button className="tool sm" onClick={() => setTerm('')} title="Təmizlə"><X size={14} /></button>
          </>}
        </div>
        {pages > 1 && (
          <div className="tool-group">
            <button className="tool" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronLeft size={16} /></button>
            <span className="tool-label">{page} / {pages}</span>
            <button className="tool" onClick={() => goPage(page + 1)} disabled={page >= pages} title="Növbəti səhifə"><ChevronRight size={16} /></button>
          </div>
        )}
        <div className="tool-group">
          <button className="tool" onClick={() => setZoom(z => Math.max(60, z - 10))} title="Kiçilt"><ZoomOut size={16} /></button>
          <span className="tool-label">{zoom}%</span>
          <button className="tool" onClick={() => setZoom(z => Math.min(220, z + 10))} title="Böyüt"><ZoomIn size={16} /></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={onFull} title="Tam ekran"><Maximize2 size={16} /></button>
          <button className="tool" onClick={() => saveBlob(blob, doc.name)} title="Orijinal faylı endir"><Download size={16} /></button>
        </div>
        {extra}
      </div>
      <iframe ref={frame} className="reader-frame word" title={doc.name} sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} />
      <div className="reader-note">Word sənədinin brauzerdə sadələşdirilmiş görünüşüdür. Orijinal rəng, qrafik və tərtibat üçün faylı endirin.</div>
    </>
  );
}
