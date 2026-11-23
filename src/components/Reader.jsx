// Reader.jsx — the document viewer. PDFs (and Word files once their PDF copy
// exists) open in the site's own viewer: page thumbnails, page jump, zoom,
// fit to width or page, rotate, search, print, download and full screen.
// A Word file without its PDF copy yet is shown as a readable page meanwhile.
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronUp, ChevronDown, ZoomIn, ZoomOut, Maximize2, Minimize2, Download, ExternalLink, Search, MoveHorizontal,
  Loader2, AlertTriangle, X, RotateCw, FileDown, PanelLeft, Printer, FileText, MoreHorizontal, Check
} from 'lucide-react';
import { Progress } from './ui.jsx';
import Drop from './Drop.jsx';
import '../styles/pdf-text.css';
import { loadDoc, saveBlob, isPdf, fmtSize } from '../lib/files.js';
import { parseDoc } from '../lib/docCache.js';
import { queuePdf, subscribe, retryPdf } from '../lib/pdfQueue.js';

const READER_CSS = `
  mark.ga-hit{background:#fde68a;color:inherit;border-radius:2px;padding:0 1px}
  mark.ga-hit.cur{background:#f59e0b;color:#fff;box-shadow:0 0 0 2px rgba(245,158,11,.35)}
  body{transition:none}
  ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#cfdae0;border-radius:10px;border:3px solid transparent;background-clip:content-box}
  ::-webkit-scrollbar-thumb:hover{background-color:#a9bcc6}::-webkit-scrollbar-button{display:none;width:0;height:0}
`;
const ZOOMS = [50, 75, 100, 125, 150, 200, 300];
const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

// fileSlot: the file name or file picker; actions: replace / delete / add buttons
export default function Reader({ doc, label, fileSlot, actions }) {
  const [blob, setBlob] = useState(null);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [full, setFull] = useState(false);
  const panel = useRef(null);

  // a Word file with a PDF copy opens as the PDF
  const variant = !isPdf(doc.name) && doc.pdf ? 'pdf' : undefined;
  useEffect(() => {
    let alive = true;
    setBlob(null); setErr(''); setProgress(0);
    loadDoc(doc, p => alive && setProgress(p), variant)
      .then(b => { if (alive) setBlob(b); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [doc.id, variant, doc.pdf?.key, attempt]);   // eslint-disable-line react-hooks/exhaustive-deps

  // a Word file without a PDF copy yet: make one in the background
  useEffect(() => { if (!isPdf(doc.name) && !doc.pdf) queuePdf(doc); }, [doc.id, doc.pdf?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else panel.current?.requestFullscreen?.();
  };

  const pdf = isPdf(doc.name) || variant === 'pdf';
  const bar = { fileSlot, actions, full, onFull: toggleFull };

  return (
    <div className="viewer" ref={panel}>
      {err ? (
        <>
          <Bar {...bar} />
          <div className="viewer-state bad">
            <AlertTriangle size={22} />
            <strong>Sənəd açılmadı</strong>
            <span>{err}</span>
            <button className="btn small" onClick={() => setAttempt(a => a + 1)}><RotateCw size={14} />Yenidən cəhd et</button>
          </div>
        </>
      ) : !blob ? (
        <>
          <Bar {...bar} />
          <div className="viewer-state">
            <Loader2 size={22} className="spin" />
            <strong>{label} yüklənir</strong>
            <span>{doc.name} · {fmtSize(variant ? doc.pdf.size : doc.size)}</span>
            <div className="viewer-progress"><Progress value={progress} /></div>
          </div>
        </>
      ) : pdf ? (
        <PdfView blob={blob} doc={doc} fromWord={!!variant} bar={bar} />
      ) : (
        <WordView blob={blob} doc={doc} bar={bar} />
      )}
    </div>
  );
}

// the toolbar frame: the file on the left, the tools, then the actions
function Bar({ fileSlot, actions, children, after }) {
  return (
    <div className="vbar">
      {children?.[0]}
      {fileSlot && <div className="vbar-file">{fileSlot}</div>}
      {children?.slice?.(1)}
      <span className="vbar-grow" />
      {after}
      {actions && <><span className="vsep" /><div className="vbar-actions">{actions}</div></>}
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

// print a PDF without showing the browser's PDF viewer: load it in a hidden frame and print that
function printPdf(url) {
  const f = document.createElement('iframe');
  f.style.cssText = 'position:fixed;right:0;bottom:0;width:1px;height:1px;border:0;opacity:0;pointer-events:none';
  f.src = url;
  f.onload = () => setTimeout(() => {
    try { f.contentWindow.focus(); f.contentWindow.print(); }
    catch { window.open(url, '_blank', 'noopener'); }
  }, 250);
  document.body.appendChild(f);
  setTimeout(() => f.remove(), 120000);
}

/* ------------------------------ PDF ------------------------------ */
let pdfjsP = null;
function pdfjs() {
  if (!pdfjsP) {
    pdfjsP = Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')]).then(([lib, worker]) => {
      lib.GlobalWorkerOptions.workerSrc = worker.default;
      return lib;
    });
  }
  return pdfjsP;
}
const lowerAz = (t) => String(t || '').toLocaleLowerCase('az');

function PdfView({ blob, doc, fromWord, bar }) {
  const pdfName = fromWord ? `${doc.name.replace(/\.[^.]+$/, '')}.pdf` : doc.name;
  const url = useObjectUrl(blob, 'application/pdf');
  const scroller = useRef(null);
  const searchBox = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [lib, setLib] = useState(null);
  const [base, setBase] = useState(null);          // first page size at 100%
  const [err, setErr] = useState('');
  const [fit, setFit] = useState('width');         // 'width' | 'page' | null (own zoom)
  const [zoom, setZoom] = useState(100);
  const [rot, setRot] = useState(0);
  const [box, setBox] = useState({ w: 0, h: 0 });
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const [thumbs, setThumbs] = useState(() => readPref('ga.thumbs', window.innerWidth > 1100));
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ list: [], cur: -1, busy: false });
  const [gettingWord, setGettingWord] = useState(false);
  const texts = useRef(new Map());

  useEffect(() => {
    let alive = true, task = null;
    (async () => {
      try {
        const L = await pdfjs();
        task = L.getDocument({ data: new Uint8Array(await blob.arrayBuffer()) });
        const d = await task.promise;
        const p1 = await d.getPage(1);
        const v = p1.getViewport({ scale: 1 });
        if (!alive) return;
        texts.current = new Map();
        setLib(L); setBase({ w: v.width, h: v.height }); setPdf(d);
      } catch (e) { if (alive) setErr(e.message || 'PDF açılmadı'); }
    })();
    return () => { alive = false; task?.destroy?.(); };
  }, [blob]);

  // follow the size of the viewer
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setBox({ w: el.clientWidth, h: el.clientHeight }));
    ro.observe(el); setBox({ w: el.clientWidth, h: el.clientHeight });
    return () => ro.disconnect();
  }, [pdf]);

  const turned = rot % 180 !== 0;
  const pw = base ? (turned ? base.h : base.w) : 1, ph = base ? (turned ? base.w : base.h) : 1;
  const clamp = (s) => Math.max(0.25, Math.min(4, s));
  const scale = !base ? 1
    : fit === 'width' ? clamp(Math.min(box.w - 48, 940) / pw)
      : fit === 'page' ? clamp(Math.min((box.w - 48) / pw, (box.h - 36) / ph))
        : zoom / 100;
  const shownZoom = Math.round(scale * 100);

  // keep the reading place when the size changes
  const lastScale = useRef(scale);
  useLayoutEffect(() => {
    const el = scroller.current, prev = lastScale.current;
    lastScale.current = scale;
    if (el && prev && prev !== scale) el.scrollTop = el.scrollTop * (scale / prev);
  }, [scale]);

  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    let cur = 1;
    for (const node of el.querySelectorAll('.pdf-page')) { if (node.offsetTop <= mid) cur = Number(node.dataset.n); else break; }
    if (cur !== page) { setPage(cur); setPageText(String(cur)); }
  };
  const goPage = useCallback((n) => {
    if (!pdf) return;
    const v = Math.max(1, Math.min(pdf.numPages, Math.floor(Number(n) || 1)));
    setPage(v); setPageText(String(v));
    const el = scroller.current, node = el?.querySelector(`.pdf-page[data-n="${v}"]`);
    if (el && node) el.scrollTop = node.offsetTop - 16;   // only the viewer scrolls
  }, [pdf]);
  const zoomTo = (z) => { setFit(null); setZoom(Math.max(25, Math.min(400, Math.round(z)))); };
  const zoomStep = (dir) => {
    const cur = shownZoom;
    const next = dir > 0 ? ZOOMS.find(z => z > cur + 1) ?? Math.min(400, cur + 50) : [...ZOOMS].reverse().find(z => z < cur - 1) ?? Math.max(25, cur - 25);
    zoomTo(next);
  };
  const rotate = () => setRot(r => (r + 90) % 360);
  const toggleThumbs = () => setThumbs(t => { writePref('ga.thumbs', !t); return !t; });

  // Ctrl+wheel zooms the document, Ctrl+F opens the search
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const wheel = (e) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      setFit(null);
      setZoom(z => Math.max(25, Math.min(400, Math.round((lastScale.current * 100) * (e.deltaY < 0 ? 1.1 : 1 / 1.1)))));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, [pdf]);
  useEffect(() => {
    const key = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault(); setFinding(true);
        setTimeout(() => searchBox.current?.select(), 0);
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  // search the text of every page
  async function textOf(n) {
    if (!texts.current.has(n)) {
      const p = await pdf.getPage(n);
      const c = await p.getTextContent();
      texts.current.set(n, lowerAz(c.items.map(i => i.str).join(' ')));
    }
    return texts.current.get(n);
  }
  useEffect(() => {
    if (!pdf) return;
    const q = lowerAz(term.trim());
    if (q.length < 2) { setHits({ list: [], cur: -1, busy: false }); return; }
    let alive = true;
    const t = setTimeout(async () => {
      setHits(h => ({ ...h, busy: true }));
      const list = [];
      for (let n = 1; n <= pdf.numPages && alive; n++) {
        const text = await textOf(n);
        let at = text.indexOf(q);
        while (at >= 0) { list.push(n); at = text.indexOf(q, at + q.length); }
      }
      if (!alive) return;
      setHits({ list, cur: list.length ? 0 : -1, busy: false });
      if (list.length) goPage(list[0]);
    }, 300);
    return () => { alive = false; clearTimeout(t); };
  }, [term, pdf]);   // eslint-disable-line react-hooks/exhaustive-deps
  const step = (d) => {
    if (!hits.list.length) return;
    const i = (hits.cur + d + hits.list.length) % hits.list.length;
    setHits(h => ({ ...h, cur: i }));
    goPage(hits.list[i]);
  };
  const closeSearch = () => { setFinding(false); setTerm(''); };

  const downloadWord = async () => {
    setGettingWord(true);
    try { saveBlob(await loadDoc(doc), doc.name); } catch { /* shown by the browser */ } finally { setGettingWord(false); }
  };
  const pages = pdf?.numPages || 0;

  return (
    <>
      <Bar {...bar} after={<>
        <button className={`vb ${finding ? 'on' : ''}`} onClick={() => { setFinding(f => !f); if (finding) setTerm(''); else setTimeout(() => searchBox.current?.focus(), 0); }} title="Mətndə axtar (Ctrl+F)"><Search size={17} /></button>
        <button className="vb wide-only" onClick={() => url && printPdf(url)} title="Çap et"><Printer size={17} /></button>
        <button className="vb" onClick={() => saveBlob(blob, pdfName)} title="PDF-i endir"><Download size={17} /></button>
        <button className="vb" onClick={bar.onFull} title={bar.full ? 'Tam ekrandan çıx' : 'Tam ekran'}>{bar.full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <Drop className="vb-more" align="right" title="Daha çox" button={<MoreHorizontal size={17} />}>
          <button className="narrow-only" onClick={rotate}><RotateCw size={15} />Döndər</button>
          <button className="narrow-only" onClick={() => setFit('page')}><FileText size={15} />Səhifəni sığdır</button>
          <button className="narrow-only" onClick={() => url && printPdf(url)}><Printer size={15} />Çap et</button>
          <a href={url || undefined} target="_blank" rel="noopener"><ExternalLink size={15} />Yeni pəncərədə aç</a>
          {fromWord && <button onClick={downloadWord} disabled={gettingWord}>{gettingWord ? <Loader2 size={15} className="spin" /> : <FileDown size={15} />}Word orijinalını endir</button>}
        </Drop>
      </>}>
        <><button className={`vb ${thumbs ? 'on' : ''}`} onClick={toggleThumbs} title="Səhifələr"><PanelLeft size={17} /></button><span className="vsep" /></>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronUp size={17} /></button>
          <input className="vpage" value={pageText} inputMode="numeric" aria-label="Səhifə"
            onChange={e => setPageText(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') goPage(pageText); }} onBlur={() => goPage(pageText)} />
          <span className="vof">/ {pages || '…'}</span>
          <button className="vb" onClick={() => goPage(page + 1)} disabled={!pdf || page >= pages} title="Növbəti səhifə"><ChevronDown size={17} /></button>
        </div>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => zoomStep(-1)} title="Kiçilt"><ZoomOut size={17} /></button>
          <Drop className="vzoom" title="Ölçü" button={<>{shownZoom}%<ChevronDown size={13} /></>}>
            <button onClick={() => setFit('width')}>{fit === 'width' ? <Check size={14} /> : <i />}Enə sığdır</button>
            <button onClick={() => setFit('page')}>{fit === 'page' ? <Check size={14} /> : <i />}Səhifəni sığdır</button>
            <hr />
            {ZOOMS.map(z => <button key={z} onClick={() => zoomTo(z)}>{!fit && zoom === z ? <Check size={14} /> : <i />}{z}%</button>)}
          </Drop>
          <button className="vb" onClick={() => zoomStep(1)} title="Böyüt"><ZoomIn size={17} /></button>
          <button className={`vb ${fit === 'width' ? 'on' : ''}`} onClick={() => setFit('width')} title="Enə sığdır"><MoveHorizontal size={17} /></button>
          <button className={`vb wide-only ${fit === 'page' ? 'on' : ''}`} onClick={() => setFit('page')} title="Səhifəni sığdır"><FileText size={17} /></button>
          <button className="vb wide-only" onClick={rotate} title="Döndər"><RotateCw size={17} /></button>
        </div>
      </Bar>

      <div className="vbody">
        {thumbs && pdf && base && <Thumbs pdf={pdf} base={base} rot={rot} page={page} onGo={goPage} />}
        <div className="pdf-scroller" ref={scroller} onScroll={onScroll}>
          {err ? <div className="viewer-state bad"><AlertTriangle size={22} /><strong>PDF açılmadı</strong><span>{err}</span></div>
            : !pdf || !base ? <div className="viewer-state"><Loader2 size={22} className="spin" /><strong>Səhifələr hazırlanır</strong></div>
              : Array.from({ length: pages }, (_, i) => (
                <PdfPage key={i + 1} lib={lib} pdf={pdf} n={i + 1} scale={scale} rot={rot} base={{ w: pw, h: ph }} root={scroller}
                  term={term.trim().length >= 2 ? lowerAz(term.trim()) : ''} current={hits.list[hits.cur] === i + 1} />
              ))}
        </div>
        {finding && (
          <div className="vfind">
            <Search size={15} />
            <input ref={searchBox} value={term} placeholder="Mətndə axtar" autoFocus onChange={e => setTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') closeSearch(); }} />
            {term.trim().length >= 2 && <span className="vfind-n">{hits.busy ? '...' : hits.list.length ? `${hits.cur + 1} / ${hits.list.length}` : 'Tapılmadı'}</span>}
            <button onClick={() => step(-1)} disabled={!hits.list.length} title="Əvvəlki"><ChevronUp size={15} /></button>
            <button onClick={() => step(1)} disabled={!hits.list.length} title="Növbəti"><ChevronDown size={15} /></button>
            <button onClick={closeSearch} title="Bağla"><X size={15} /></button>
          </div>
        )}
      </div>
    </>
  );
}

// page thumbnails on the left of the document
function Thumbs({ pdf, base, rot, page, onGo }) {
  const pane = useRef(null);
  useEffect(() => {
    const el = pane.current, node = el?.querySelector(`[data-t="${page}"]`);
    if (!el || !node) return;
    const top = node.offsetTop, bottom = top + node.offsetHeight;
    if (top < el.scrollTop + 8 || bottom > el.scrollTop + el.clientHeight - 8) el.scrollTop = top - el.clientHeight / 3;
  }, [page]);
  return (
    <aside className="thumbs" ref={pane} aria-label="Səhifələr">
      {Array.from({ length: pdf.numPages }, (_, i) => (
        <Thumb key={i + 1} pdf={pdf} n={i + 1} base={base} rot={rot} on={page === i + 1} root={pane} onGo={onGo} />
      ))}
    </aside>
  );
}

const THUMB_W = 96;
function Thumb({ pdf, n, base, rot, on, root, onGo }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const [near, setNear] = useState(n <= 6);
  const [ratio, setRatio] = useState(null);
  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => { if (e.isIntersecting) setNear(true); }, { root: root.current, rootMargin: '600px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);
  useEffect(() => {
    if (!near) return;
    let alive = true, task = null;
    (async () => {
      const p = await pdf.getPage(n);
      if (!alive) return;
      const v1 = p.getViewport({ scale: 1, rotation: (p.rotate + rot) % 360 });
      setRatio(v1.height / v1.width);
      const vp = p.getViewport({ scale: THUMB_W / v1.width, rotation: (p.rotate + rot) % 360 });
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(vp.width * 2); c.height = Math.floor(vp.height * 2);
      task = p.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: [2, 0, 0, 2, 0, 0] });
      try { await task.promise; } catch { /* cancelled */ }
    })();
    return () => { alive = false; task?.cancel?.(); };
  }, [near, pdf, n, rot]);
  const h = THUMB_W * (ratio || (rot % 180 ? base.w / base.h : base.h / base.w));
  return (
    <button className={`thumb ${on ? 'on' : ''}`} data-t={n} ref={box} onClick={() => onGo(n)} title={`Səhifə ${n}`}>
      <span className="thumb-img" style={{ width: THUMB_W, height: h }}>{near && <canvas ref={canvas} style={{ width: THUMB_W, height: h }} />}</span>
      <span className="thumb-n">{n}</span>
    </button>
  );
}

// one page: drawn when it comes near the screen
function PdfPage({ lib, pdf, n, scale, rot, base, root, term, current }) {
  const box = useRef(null);
  const canvas = useRef(null);
  const textDiv = useRef(null);
  const [near, setNear] = useState(n <= 2);
  const [size, setSize] = useState(null);       // this page's own size at 100%
  const [drawn, setDrawn] = useState(0);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root: root.current, rootMargin: '1200px 0px' });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  useEffect(() => {
    if (!near) return;
    let alive = true, task = null, layer = null;
    (async () => {
      const p = await pdf.getPage(n);
      if (!alive) return;
      const rotation = (p.rotate + rot) % 360;
      const v1 = p.getViewport({ scale: 1, rotation });
      setSize({ w: v1.width, h: v1.height });
      const vp = p.getViewport({ scale, rotation });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current;
      if (!c) return;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      task = p.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : null });
      try { await task.promise; } catch { return; }
      if (!alive || !textDiv.current) return;
      const t = textDiv.current;
      t.replaceChildren();
      t.style.setProperty('--scale-factor', String(scale));
      layer = new lib.TextLayer({ textContentSource: p.streamTextContent(), container: t, viewport: vp });
      try { await layer.render(); } catch { return; }
      if (alive) setDrawn(d => d + 1);
    })();
    return () => { alive = false; task?.cancel?.(); layer?.cancel?.(); };
  }, [near, scale, rot, pdf, n, lib]);

  // mark the words that match the search
  useEffect(() => {
    const t = textDiv.current;
    if (!t) return;
    let first = null;
    for (const s of t.querySelectorAll('span')) {
      const on = !!term && lowerAz(s.textContent).includes(term);
      s.classList.toggle('ga-hl', on);
      s.classList.toggle('cur', on && current && !first);
      if (on && !first) first = s;
    }
    const el = root.current;
    if (current && first && el) {
      const r = first.getBoundingClientRect(), b = el.getBoundingClientRect();
      el.scrollTop += r.top - b.top - el.clientHeight / 2;
    }
  }, [term, current, drawn, root]);

  const w = (size || base).w * scale, h = (size || base).h * scale;
  return (
    <div className="pdf-page" data-n={n} ref={box} style={{ width: w, height: h }}>
      {near && <canvas ref={canvas} />}
      {near && <div className="textLayer" ref={textDiv} />}
      {!near && <span className="pdf-page-no">{n}</span>}
    </div>
  );
}

function PdfProgress({ doc }) {
  const [job, setJob] = useState(null);
  useEffect(() => subscribe(list => setJob(list.find(j => j.id === doc.id) || null)), [doc.id]);
  if (!job || job.state === 'done') return null;
  return (
    <div className={`pdf-banner ${job.state === 'failed' ? 'bad' : ''}`}>
      {job.state === 'failed'
        ? <><AlertTriangle size={14} /><span>PDF yaradılmadı: {job.error}</span><button onClick={() => retryPdf(doc.id)}><RotateCw size={13} />Yenidən</button></>
        : <><Loader2 size={14} className="spin" /><span>PDF hazırlanır{job.step ? `: ${job.step}` : ''}. Hazır olanda bu sənəd özü PDF kimi açılacaq.</span></>}
    </div>
  );
}

/* ------------------------------ Word, until its PDF is ready ------------------------------ */
function WordView({ blob, doc, bar }) {
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(100);
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ n: 0, cur: -1 });
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const frame = useRef(null);
  const marks = useRef([]);
  const searchBox = useRef(null);

  useEffect(() => {
    let alive = true;
    setParsed(null); setErr('');
    parseDoc(doc.id, blob, doc.name)
      .then(r => { if (alive) setParsed(r); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [blob, doc.name]);

  const html = useMemo(() => parsed?.html?.replace(/<script[\s\S]*?<\/script>/gi, '').replace('</head>', `<style>${READER_CSS}</style></head>`) || '', [parsed]);
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
    d.addEventListener('scroll', () => {
      const all = d.querySelectorAll('div.docpage');
      let cur = 1;
      all.forEach((p, i) => { if (p.getBoundingClientRect().top < 120) cur = i + 1; });
      setPage(cur);
    }, { passive: true });
    d.addEventListener('keydown', (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFinding(true); setTimeout(() => searchBox.current?.select(), 0); }
    });
    if (term) runSearch(term);
  };
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); setFinding(true); setTimeout(() => searchBox.current?.select(), 0); } };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

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
      if (low.length !== node.nodeValue.length) continue;
      const at = [];
      for (let i = low.indexOf(needle); i >= 0; i = low.indexOf(needle, i + needle.length)) at.push(i);
      if (!at.length) continue;
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
  const closeSearch = () => { setFinding(false); setTerm(''); };

  if (err) {
    return (
      <>
        <Bar {...bar} />
        <div className="viewer-state bad">
          <AlertTriangle size={22} />
          <strong>Sənədin mətni oxunmadı</strong>
          <span>{err}</span>
          <button className="btn small" onClick={() => saveBlob(blob, doc.name)}><Download size={14} />Orijinal faylı endir</button>
        </div>
      </>
    );
  }

  return (
    <>
      <Bar {...bar} after={<>
        <button className={`vb ${finding ? 'on' : ''}`} onClick={() => { setFinding(f => !f); if (finding) setTerm(''); else setTimeout(() => searchBox.current?.focus(), 0); }} title="Mətndə axtar (Ctrl+F)"><Search size={17} /></button>
        <button className="vb" onClick={() => frame.current?.contentWindow?.print()} title="Çap et"><Printer size={17} /></button>
        <button className="vb" onClick={() => saveBlob(blob, doc.name)} title="Word faylını endir"><Download size={17} /></button>
        <button className="vb" onClick={bar.onFull} title={bar.full ? 'Tam ekrandan çıx' : 'Tam ekran'}>{bar.full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </>}>
        <></>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronUp size={17} /></button>
          <span className="vof">{page} / {pages}</span>
          <button className="vb" onClick={() => goPage(page + 1)} disabled={page >= pages} title="Növbəti səhifə"><ChevronDown size={17} /></button>
        </div>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => setZoom(z => Math.max(50, z - 10))} title="Kiçilt"><ZoomOut size={17} /></button>
          <Drop className="vzoom" title="Ölçü" button={<>{zoom}%<ChevronDown size={13} /></>}>
            {[60, 80, 100, 120, 150, 200].map(z => <button key={z} onClick={() => setZoom(z)}>{zoom === z ? <Check size={14} /> : <i />}{z}%</button>)}
          </Drop>
          <button className="vb" onClick={() => setZoom(z => Math.min(250, z + 10))} title="Böyüt"><ZoomIn size={17} /></button>
        </div>
      </Bar>
      <PdfProgress doc={doc} />
      <div className="vbody">
        {!parsed
          ? <div className="viewer-state"><Loader2 size={22} className="spin" /><strong>Sənəd hazırlanır</strong><span>{doc.name}</span></div>
          : <iframe ref={frame} className="word-frame" title={doc.name} sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={onLoad} />}
        {finding && (
          <div className="vfind">
            <Search size={15} />
            <input ref={searchBox} value={term} placeholder="Mətndə axtar" autoFocus onChange={e => setTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') closeSearch(); }} />
            {term.trim().length >= 2 && <span className="vfind-n">{hits.n ? `${hits.cur + 1} / ${hits.n}` : 'Tapılmadı'}</span>}
            <button onClick={() => step(-1)} disabled={!hits.n} title="Əvvəlki"><ChevronUp size={15} /></button>
            <button onClick={() => step(1)} disabled={!hits.n} title="Növbəti"><ChevronDown size={15} /></button>
            <button onClick={closeSearch} title="Bağla"><X size={15} /></button>
          </div>
        )}
      </div>
    </>
  );
}
