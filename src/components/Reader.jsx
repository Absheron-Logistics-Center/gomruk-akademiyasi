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
import { addLook, LAYOUT_V, canSaveLayout, pack, unpack, layOut, pageText as textOfPage, isComputer } from '../lib/docxLayout.js';
import { api } from '../lib/api.js';
import { uploadPieces, cachePut } from '../lib/files.js';
import { hasExactPdf, makePdf, msStatus, msReadyNow } from '../lib/pdfQueue.js';

// PDFs made by Microsoft (Word for the web, on the server) look exactly like the Word file
export const isExactPdf = hasExactPdf;

const READER_CSS = `
  mark.ga-hit{background:#fde68a;color:inherit;border-radius:2px;padding:0 1px}
  mark.ga-hit.cur{background:#f59e0b;color:#fff;box-shadow:0 0 0 2px rgba(245,158,11,.35)}
  body{transition:none}
  ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#b9c9d2;border-radius:10px;border:3px solid transparent;background-clip:content-box}
  ::-webkit-scrollbar-thumb:hover{background-color:#94abb8}::-webkit-scrollbar-button{display:none;width:0;height:0}
`;
const ZOOMS = [50, 75, 100, 125, 150, 200, 300];
const OFFICE_MAX = 4.4 * 1024 * 1024;
const readPref = (k, d) => { try { const v = localStorage.getItem(k); return v === null ? d : v === '1'; } catch { return d; } };
const writePref = (k, v) => { try { localStorage.setItem(k, v ? '1' : '0'); } catch { /* private mode */ } };

// fileSlot: the file name or file picker; actions: replace / delete / add buttons
export default function Reader({ doc, label, fileSlot, actions }) {
  const word = !isPdf(doc.name);
  // pdf: a PDF file · saved: a Word file's ready layout (opens at once) · docx: a Word file
  // laid out now (then saved as its ready layout) · pdfcopy: the PDF made from it ·
  // word: plain reading view while a PDF copy is made (old .doc files, unreadable layouts)
  // a Word file with its exact PDF (made by Microsoft Word on the server) opens as that PDF
  const exact = word && isExactPdf(doc);
  // office: Microsoft's own Word viewer shows the file exactly as Word does (files up to 4.4 MB)
  const ownLayout = () => (doc.layout?.v === LAYOUT_V && canSaveLayout() ? 'saved' : 'docx');
  // making: Microsoft turns the Word file into its exact PDF (once per file, then it opens at once)
  const fallback = () => ((doc.size || 0) <= OFFICE_MAX ? 'office' : ownLayout());
  const first = () => (!word ? 'pdf' : exact ? 'pdfcopy' : msReadyNow() === false ? fallback() : 'making');
  const [mode, setMode] = useState(first);
  const [made, setMade] = useState(null);   // the PDF just made, until the lesson list has it
  const pdoc = made && !exact ? { ...doc, pdf: made } : doc;
  const [blob, setBlob] = useState(null);
  const [err, setErr] = useState('');
  const [progress, setProgress] = useState(0);
  const [attempt, setAttempt] = useState(0);
  const [full, setFull] = useState(false);
  const panel = useRef(null);

  useEffect(() => { setMade(null); setMode(first()); }, [doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    if (mode !== 'making') return;
    let alive = true;
    msStatus().then(st => {
      if (!alive) return;
      if (!st.ready) { setMode(fallback()); return; }
      makePdf(doc)
        .then(pdf => { if (alive) { setMade(pdf); setMode('pdfcopy'); } })
        .catch(() => { if (alive) setMode(fallback()); });
    });
    return () => { alive = false; };
  }, [mode, doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  // the PDF copy became ready while the plain view was showing
  useEffect(() => { if (exact && mode !== 'pdfcopy') setMode('pdfcopy'); }, [doc.pdf?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  const variant = mode === 'pdfcopy' ? 'pdf' : mode === 'saved' ? 'layout' : undefined;
  useEffect(() => {
    let alive = true;
    setBlob(null); setErr(''); setProgress(0);
    if (mode === 'office' || mode === 'making') return () => { alive = false; };   // nothing to load yet
    loadDoc(pdoc, p => alive && setProgress(p), variant)
      .then(b => { if (alive) setBlob(b); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [doc.id, variant, attempt, mode === 'office' || mode === 'making', pdoc.pdf?.key]);   // eslint-disable-line react-hooks/exhaustive-deps

  // the Word layout could not be shown: use the PDF copy, or the plain view and make a copy
  const layoutFailed = useCallback(() => {
    if (isExactPdf(doc)) setMode('pdfcopy');
    else setMode('word');
  }, [doc]);

  useEffect(() => {
    const on = () => setFull(document.fullscreenElement === panel.current);
    document.addEventListener('fullscreenchange', on);
    return () => document.removeEventListener('fullscreenchange', on);
  }, []);
  const toggleFull = () => {
    if (document.fullscreenElement) document.exitFullscreen?.();
    else panel.current?.requestFullscreen?.();
  };

  const bar = { fileSlot, actions, full, onFull: toggleFull };

  return (
    <div className="viewer" ref={panel}>
      {mode === 'making' ? (
        <>
          <Bar {...bar} />
          <div className="viewer-state">
            <Loader2 size={22} className="spin" />
            <strong>Sənəd hazırlanır</strong>
            <span>Word faylı PDF-ə çevrilir. Bu yalnız ilk açılışda olur, sonra dərhal açılacaq.</span>
          </div>
        </>
      ) : mode === 'office' ? (
        <OfficeView key={doc.id} doc={doc} bar={bar} onFail={() => setMode(ownLayout())} />
      ) : err ? (
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
            <span>{doc.name} · {fmtSize(variant ? pdoc[variant]?.size : doc.size)}</span>
            <div className="viewer-progress"><Progress value={progress} /></div>
          </div>
        </>
      ) : mode === 'pdf' || mode === 'pdfcopy' ? (
        <PdfView blob={blob} doc={pdoc} fromWord={mode === 'pdfcopy'} bar={bar} />
      ) : mode === 'docx' || mode === 'saved' ? (
        <DocxView key={`${doc.id}:${mode}`} blob={blob} saved={mode === 'saved'} doc={doc} bar={bar}
          onFail={mode === 'saved' ? () => setMode('docx') : layoutFailed} />
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
  const [widest, setWidest] = useState(null);      // the widest and tallest page, so no page is cut off
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
        setLib(L); setBase({ w: v.width, h: v.height }); setPdf(d); setWidest(null);
        // documents can mix portrait and landscape pages: fit to the widest one
        let w = v.width, h = v.height;
        for (let n = 2; n <= d.numPages && alive; n++) {
          const pv = (await d.getPage(n)).getViewport({ scale: 1 });
          w = Math.max(w, pv.width); h = Math.max(h, pv.height);
        }
        if (alive && (w > v.width + 1 || h > v.height + 1)) setWidest({ w, h });
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
  const size = widest || base;
  const pw = size ? (turned ? size.h : size.w) : 1, ph = size ? (turned ? size.w : size.h) : 1;
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

  const pages = pdf?.numPages || 0;

  return (
    <>
      <Bar {...bar} after={<>
        <button className={`vb ${finding ? 'on' : ''}`} onClick={() => { setFinding(f => !f); if (finding) setTerm(''); else setTimeout(() => searchBox.current?.focus(), 0); }} title="Mətndə axtar (Ctrl+F)"><Search size={17} /></button>
        <button className="vb wide-only" onClick={() => url && printPdf(url)} title="Çap et"><Printer size={17} /></button>
        {fromWord
          ? <Downloads doc={doc} pdf={() => blob} />
          : <button className="vb" onClick={() => saveBlob(blob, pdfName)} title="PDF-i endir"><Download size={17} /></button>}
        <button className="vb" onClick={bar.onFull} title={bar.full ? 'Tam ekrandan çıx' : 'Tam ekran'}>{bar.full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <Drop className="vb-more" align="right" title="Daha çox" button={<MoreHorizontal size={17} />}>
          <button className="narrow-only" onClick={rotate}><RotateCw size={15} />Döndər</button>
          <button className="narrow-only" onClick={() => setFit('page')}><FileText size={15} />Səhifəni sığdır</button>
          <button className="narrow-only" onClick={() => url && printPdf(url)}><Printer size={15} />Çap et</button>
          <a href={url || undefined} target="_blank" rel="noopener"><ExternalLink size={15} />Yeni pəncərədə aç</a>
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
                <PdfPage key={i + 1} lib={lib} pdf={pdf} n={i + 1} scale={scale} rot={rot} base={turned ? { w: base.h, h: base.w } : base} root={scroller}
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

// download for a Word file: the original Word file, and its PDF when there is one
function Downloads({ doc, word, pdf }) {
  const [busy, setBusy] = useState('');
  const base = doc.name.replace(/\.[^.]+$/, '');
  const get = async (what) => {
    setBusy(what);
    try {
      if (what === 'word') saveBlob(word?.() || await loadDoc(doc), doc.name);
      else saveBlob(pdf?.() || await loadDoc(doc, null, 'pdf'), `${base}.pdf`);
    } catch { /* the browser shows the problem */ } finally { setBusy(''); }
  };
  const ext = (doc.name.split('.').pop() || 'doc').toUpperCase();
  return (
    <Drop className="vb-more" align="right" title="Endir" button={busy ? <Loader2 size={17} className="spin" /> : <Download size={17} />}>
      <button onClick={() => get('word')}><FileDown size={15} />Orijinal Word faylını endir ({ext})</button>
      {isExactPdf(doc) && <button onClick={() => get('pdf')}><FileDown size={15} />PDF kimi endir</button>}
    </Drop>
  );
}

/* ------------------------------ search inside a page frame ------------------------------ */
// Finds the words even when Word split them into several pieces of text,
// and marks every place where they appear.
function useFrameFind(docOf, ready) {
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ n: 0, cur: -1 });
  const groups = useRef([]);
  const box = useRef(null);

  const clear = () => {
    const touched = new Set();
    for (const g of groups.current) for (const m of g) {
      const parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(m.ownerDocument.createTextNode(m.textContent), m);
      touched.add(parent);
    }
    touched.forEach(p => p.normalize());
    groups.current = [];
  };
  const focus = (i) => {
    groups.current.forEach(g => g.forEach(m => m.classList.remove('cur')));
    const g = groups.current[i];
    if (!g?.length) return;
    g.forEach(m => m.classList.add('cur'));
    g[0].scrollIntoView({ block: 'center' });
  };
  const run = (q) => {
    const d = docOf();
    if (!d?.body) return;
    clear();
    const needle = q.trim().toLocaleLowerCase('az');
    if (needle.length < 2) { setHits({ n: 0, cur: -1 }); return; }
    const found = [];
    const blocks = d.body.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th, .docpage');
    const seen = new Set();
    for (const el of blocks) {
      if (found.length >= 3000) break;
      if (el.querySelector('p, li, td, th') || el.closest('.ga-thumbs')) continue;   // innermost text blocks, not the page thumbnails
      const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
      const parts = []; let text = '';
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (seen.has(n)) continue; seen.add(n);
        const low = n.nodeValue.toLocaleLowerCase('az');
        if (low.length !== n.nodeValue.length) continue;
        parts.push({ n, at: text.length }); text += low;
      }
      if (!text) continue;
      const starts = [];
      for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) starts.push(i);
      const here = [];
      for (let k = starts.length - 1; k >= 0; k--) {
        const s0 = starts[k], e0 = s0 + needle.length, group = [];
        for (let j = parts.length - 1; j >= 0; j--) {
          const { n, at } = parts[j], end = at + n.nodeValue.length;
          if (end <= s0 || at >= e0) continue;
          const s = Math.max(0, s0 - at), e = Math.min(n.nodeValue.length, e0 - at);
          if (e < n.nodeValue.length) n.splitText(e);
          const mid = s > 0 ? n.splitText(s) : n;
          const m = d.createElement('mark');
          m.className = 'ga-hit';
          mid.parentNode.replaceChild(m, mid);
          m.appendChild(mid);
          group.unshift(m);
        }
        if (group.length) here.unshift(group);
      }
      found.push(...here);
    }
    groups.current = found;
    setHits({ n: found.length, cur: found.length ? 0 : -1 });
    if (found.length) focus(0);
  };
  useEffect(() => {
    if (!ready) return;
    const t = setTimeout(() => run(term), 250);
    return () => clearTimeout(t);
  }, [term, ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  const step = (dir) => {
    if (!hits.n) return;
    const i = (hits.cur + dir + hits.n) % hits.n;
    setHits(h => ({ ...h, cur: i }));
    focus(i);
  };
  const open = () => { setFinding(true); setTimeout(() => box.current?.select(), 0); };
  const close = () => { setFinding(false); setTerm(''); };
  const toggle = () => (finding ? close() : open());

  // Ctrl+F opens the search, on the page and inside the document
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); open(); } };
    window.addEventListener('keydown', key);
    const d = ready ? docOf() : null;
    d?.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); d?.removeEventListener('keydown', key); };
  }, [ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  const panel = finding && (
    <div className="vfind">
      <Search size={15} />
      <input ref={box} value={term} placeholder="Mətndə axtar" autoFocus onChange={e => setTerm(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') close(); }} />
      {term.trim().length >= 2 && <span className="vfind-n">{hits.n ? `${hits.cur + 1} / ${hits.n}` : 'Tapılmadı'}</span>}
      <button onClick={() => step(-1)} disabled={!hits.n} title="Əvvəlki"><ChevronUp size={15} /></button>
      <button onClick={() => step(1)} disabled={!hits.n} title="Növbəti"><ChevronDown size={15} /></button>
      <button onClick={close} title="Bağla"><X size={15} /></button>
    </div>
  );
  return { finding, toggle, panel };
}

/* ------------------------------ Word, in Microsoft's Word viewer ------------------------------ */
// The file is shown by Office Online, Microsoft's Word on the web: the same fonts, line
// breaks and pages as in Word, drawn on Microsoft's side (fast and light for the browser).
function OfficeView({ doc, bar, onFail }) {
  const [src, setSrc] = useState('');
  const [err, setErr] = useState('');
  const [loaded, setLoaded] = useState(false);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    let alive = true;
    api.share(doc.id)
      .then(r => { if (alive) setSrc(`${location.origin}${r.path}`); })
      .catch(e => { if (alive) { if (/böyük/.test(e.message)) onFail(); else setErr(e.message); } });
    const t = setTimeout(() => alive && setSlow(true), 20000);
    return () => { alive = false; clearTimeout(t); };
  }, [doc.id]);   // eslint-disable-line react-hooks/exhaustive-deps
  const viewer = src ? `https://view.officeapps.live.com/op/embed.aspx?src=${encodeURIComponent(src)}` : '';
  const full = src ? `https://view.officeapps.live.com/op/view.aspx?src=${encodeURIComponent(src)}` : '';
  return (
    <>
      <Bar {...bar} after={<>
        <Downloads doc={doc} />
        <button className="vb" onClick={bar.onFull} title={bar.full ? 'Tam ekrandan çıx' : 'Tam ekran'}>{bar.full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
        <Drop className="vb-more" align="right" title="Daha çox" button={<MoreHorizontal size={17} />}>
          <a href={full || undefined} target="_blank" rel="noopener"><ExternalLink size={15} />Word görünüşündə yeni pəncərədə aç</a>
          <button onClick={onFail}><FileText size={15} />Saytın öz görünüşü</button>
        </Drop>
      </>} />
      <div className="vbody">
        {err ? (
          <div className="viewer-state bad"><AlertTriangle size={22} /><strong>Sənəd açılmadı</strong><span>{err}</span>
            <button className="btn small" onClick={onFail}><FileText size={14} />Saytın öz görünüşündə aç</button></div>
        ) : (
          <>
            {!loaded && (
              <div className="viewer-state over">
                <Loader2 size={22} className="spin" /><strong>Sənəd açılır</strong><span>{doc.name}</span>
                {slow && <button className="btn small" onClick={onFail}><FileText size={14} />Açılmırsa: saytın öz görünüşü</button>}
              </div>
            )}
            {viewer && <iframe className="word-frame office-frame" title={doc.name} src={viewer} onLoad={() => setTimeout(() => setLoaded(true), 3500)} allow="fullscreen" />}
          </>
        )}
      </div>
    </>
  );
}

/* ------------------------------ Word, in its own layout ------------------------------ */
// The first opening lays the pages out (once) and saves them, so every later opening, by
// anyone, is instant. Only the pages near the screen are put into the page: a long law
// stays light. Only a computer saves the layout: its fonts are the ones Word uses.
const saving = new Set();
async function saveLayout(data, doc) {
  if (!canSaveLayout() || saving.has(doc.id) || doc.layout?.v === LAYOUT_V || !isComputer()) return;
  saving.add(doc.id);
  try {
    const gz = await pack(data);
    const up = await uploadPieces(gz, `${doc.name.replace(/\.[^.]+$/, '')}.html.gz`);
    await api.attachLayout(doc.id, { ...up, v: LAYOUT_V });
    cachePut(`${doc.id}:layout:${up.uploadId}`, gz).catch(() => {});
    window.dispatchEvent(new CustomEvent('ga:changed'));
  } catch { saving.delete(doc.id); }
}

// mark every place where the words appear inside one element; returns groups of marks
function markIn(d, root, needle) {
  const found = [];
  const blocks = [...root.querySelectorAll('p, h1, h2, h3, h4, h5, h6, li, td, th')].filter(el => !el.querySelector('p, li, td, th'));
  const seen = new Set();
  for (const el of blocks) {
    const walker = d.createTreeWalker(el, NodeFilter.SHOW_TEXT);
    const parts = []; let text = '';
    while (walker.nextNode()) {
      const n = walker.currentNode;
      if (seen.has(n)) continue; seen.add(n);
      const low = n.nodeValue.toLocaleLowerCase('az');
      if (low.length !== n.nodeValue.length) continue;
      parts.push({ n, at: text.length }); text += low;
    }
    if (!text) continue;
    const starts = [];
    for (let i = text.indexOf(needle); i >= 0; i = text.indexOf(needle, i + needle.length)) starts.push(i);
    const here = [];
    for (let k = starts.length - 1; k >= 0; k--) {
      const s0 = starts[k], e0 = s0 + needle.length, group = [];
      for (let j = parts.length - 1; j >= 0; j--) {
        const { n, at } = parts[j], end = at + n.nodeValue.length;
        if (end <= s0 || at >= e0) continue;
        const a = Math.max(0, s0 - at), b = Math.min(n.nodeValue.length, e0 - at);
        if (b < n.nodeValue.length) n.splitText(b);
        const mid = a > 0 ? n.splitText(a) : n;
        const m = d.createElement('mark');
        m.className = 'ga-hit';
        mid.parentNode.replaceChild(m, mid);
        m.appendChild(mid);
        group.unshift(m);
      }
      if (group.length) here.unshift(group);
    }
    found.push(...here);
  }
  return found;
}

const THUMBS_W = 150;
const DOCX_FRAME = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';

function DocxView({ blob, saved, doc, bar, onFail }) {
  const frame = useRef(null);
  const lay = useRef(null);             // { head, pages: [{ w, h, html }] }
  const slots = useRef([]);             // the element now standing for each page
  const io = useRef(null);
  const printing = useRef(false);
  const [ready, setReady] = useState(false);
  const [busy, setBusy] = useState('Sənəd hazırlanır');
  const [pageW, setPageW] = useState(0);
  const [frameW, setFrameW] = useState(0);
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
  const [thumbs, setThumbs] = useState(() => readPref('ga.thumbs', window.innerWidth > 1100));
  const docOf = () => frame.current?.contentDocument || null;
  const toggleThumbs = () => setThumbs(t => { writePref('ga.thumbs', !t); return !t; });

  // a page in the page, or only its empty frame of the same size
  const placeholder = (d, i) => {
    const p = lay.current.pages[i];
    const el = d.createElement('section');
    el.className = 'docx ga-ph';
    el.dataset.i = String(i);
    el.style.cssText = `width:${p.w}px;height:${p.h}px;min-height:0;padding:0;box-sizing:border-box`;
    return el;
  };
  const show = (i) => {
    const d = docOf(), cur = slots.current[i];
    if (!d || !cur || !cur.classList.contains('ga-ph')) return cur;
    const t = d.createElement('template');
    t.innerHTML = lay.current.pages[i].html;
    const el = t.content.firstElementChild;
    if (!el) return cur;
    el.dataset.i = String(i);
    cur.replaceWith(el);
    io.current?.unobserve(cur); io.current?.observe(el);
    slots.current[i] = el;
    return el;
  };
  const hide = (i) => {
    const d = docOf(), cur = slots.current[i];
    if (!d || !cur || cur.classList.contains('ga-ph') || printing.current) return;
    const el = placeholder(d, i);
    cur.replaceWith(el);
    io.current?.unobserve(cur); io.current?.observe(el);
    slots.current[i] = el;
  };

  async function onLoad() {
    const d = docOf();
    if (!d || d.body.dataset.done) return;
    d.body.dataset.done = '1';
    try {
      let data = saved ? await unpack(blob) : null;
      if (!data) {
        if (saved) throw new Error('köhnə');
        setBusy('Səhifələr hazırlanır');
        data = await layOut(blob);
        saveLayout(data, doc);
      }
      lay.current = data;
      d.head.innerHTML = data.head;
      addLook(d);
      const wrap = d.createElement('div');
      wrap.className = 'docx-wrapper';
      slots.current = data.pages.map((_, i) => placeholder(d, i));
      wrap.append(...slots.current);
      d.body.appendChild(wrap);
      io.current = new d.defaultView.IntersectionObserver((list) => {
        for (const e of list) {
          const i = Number(e.target.dataset.i);
          if (e.isIntersecting) show(i); else hide(i);
        }
      }, { rootMargin: '1400px 0px' });
      slots.current.forEach(el => io.current.observe(el));
      setPages(data.pages.length);
      // fit to the widest page, so landscape pages are never cut off
      setPageW(Math.max(...data.pages.map(p => p.w)));
      d.addEventListener('scroll', track, { passive: true });
      setReady(true);
    } catch {
      onFail();
    }
  }
  useEffect(() => () => io.current?.disconnect(), []);
  let ticking = false;
  function track() {
    if (ticking) return;
    ticking = true;
    requestAnimationFrame(() => {
      ticking = false;
      const limit = (frame.current?.clientHeight || 600) * 0.35;
      let cur = 1;
      for (let i = 0; i < slots.current.length; i++) { if (slots.current[i].getBoundingClientRect().top < limit) cur = i + 1; else break; }
      setPage(p => { if (p !== cur) setPageText(String(cur)); return cur; });
    });
  }

  useEffect(() => {
    const el = frame.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setFrameW(el.clientWidth));
    ro.observe(el); setFrameW(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  const room = frameW - (thumbs && frameW > 700 ? THUMBS_W : 0);
  const scale = fit && pageW ? Math.max(0.3, Math.min(3, Math.min(940, room - 64) / pageW)) : zoom / 100;
  const goRef = useRef(null);

  // page thumbnails: small copies of the pages near the thumbnail view, a few at a time
  useEffect(() => {
    const d = docOf();
    if (!ready || !d || d.querySelector('.ga-thumbs')) return;
    const aside = d.createElement('aside');
    aside.className = 'ga-thumbs';
    const P = lay.current.pages;
    const drawn = [];
    const clear = (b) => { b.querySelector('.ga-thumb-img').replaceChildren(); delete b.dataset.drawn; };
    const tio = new d.defaultView.IntersectionObserver((list) => {
      for (const e of list) {
        if (!e.isIntersecting) {
          if (e.target.dataset.drawn) { clear(e.target); drawn.splice(drawn.indexOf(e.target), 1); }
          continue;
        }
        if (e.target.dataset.drawn) continue;
        const i = Number(e.target.dataset.i);
        e.target.dataset.drawn = '1';
        drawn.push(e.target);
        while (drawn.length > 14) {
          let far = 0;
          drawn.forEach((b, j) => { if (Math.abs(Number(b.dataset.i) - i) > Math.abs(Number(drawn[far].dataset.i) - i)) far = j; });
          clear(drawn[far]); drawn.splice(far, 1);
        }
        const t = d.createElement('template');
        t.innerHTML = P[i].html;
        const copy = t.content.firstElementChild;
        if (!copy) continue;
        copy.style.cssText += `;margin:0!important;box-shadow:none!important;background:#fff;transform:scale(${THUMB_W / P[i].w});transform-origin:0 0;pointer-events:none`;
        e.target.querySelector('.ga-thumb-img').appendChild(copy);
      }
    }, { root: aside, rootMargin: '200px 0px' });
    P.forEach((p, i) => {
      const b = d.createElement('button');
      b.className = 'ga-thumb'; b.dataset.i = String(i); b.type = 'button';
      const img = d.createElement('span');
      img.className = 'ga-thumb-img';
      img.style.width = `${THUMB_W}px`;
      img.style.height = `${Math.round(THUMB_W * p.h / Math.max(1, p.w))}px`;
      const n = d.createElement('span');
      n.textContent = String(i + 1);
      b.append(img, n);
      b.addEventListener('click', () => goRef.current?.(i + 1));
      aside.appendChild(b);
      tio.observe(b);
    });
    d.body.appendChild(aside);
    return () => tio.disconnect();
  }, [ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { docOf()?.body?.classList.toggle('thumbs-open', thumbs && frameW > 700); }, [thumbs, ready, frameW]);   // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => {
    const aside = docOf()?.querySelector('.ga-thumbs');
    if (!aside) return;
    aside.querySelectorAll('.ga-thumb.on').forEach(b => b.classList.remove('on'));
    const cur = aside.children[page - 1];
    if (!cur) return;
    cur.classList.add('on');
    const top = cur.offsetTop, bottom = top + cur.offsetHeight;
    if (top < aside.scrollTop + 8 || bottom > aside.scrollTop + aside.clientHeight - 8) aside.scrollTop = top - aside.clientHeight / 3;
  }, [page, ready, thumbs]);   // eslint-disable-line react-hooks/exhaustive-deps
  const shown = Math.round(scale * 100);
  useEffect(() => {
    const w = docOf()?.querySelector('.docx-wrapper');
    if (w) w.style.zoom = String(scale);
  }, [scale, ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  const goPage = (n) => {
    const v = Math.max(1, Math.min(pages, Math.floor(Number(n) || 1)));
    setPage(v); setPageText(String(v));
    slots.current[v - 1]?.scrollIntoView({ block: 'start' });
  };
  goRef.current = goPage;
  const zoomTo = (z) => { setFit(false); setZoom(Math.max(25, Math.min(400, Math.round(z)))); };
  const zoomStep = (dir) => {
    const next = dir > 0 ? ZOOMS.find(z => z > shown + 1) ?? Math.min(400, shown + 50) : [...ZOOMS].reverse().find(z => z < shown - 1) ?? Math.max(25, shown - 25);
    zoomTo(next);
  };

  // printing needs every page: put them all in for the print, then take them out again
  const printAll = () => {
    const d = docOf(), w = frame.current?.contentWindow;
    if (!d || !w) return;
    printing.current = true;
    slots.current.forEach((_, i) => show(i));
    try { w.print(); } finally {
      printing.current = false;
      setTimeout(() => {
        const h = frame.current?.clientHeight || 900;
        slots.current.forEach((el, i) => { const r = el.getBoundingClientRect(); if (r.bottom < -1400 || r.top > h + 1400) hide(i); });
      }, 300);
    }
  };

  /* search: every page's text is searched without putting the pages in */
  const [finding, setFinding] = useState(false);
  const [term, setTerm] = useState('');
  const [hits, setHits] = useState({ list: [], cur: -1 });
  const texts = useRef(null);
  const marks = useRef([]);
  const box = useRef(null);
  const unmark = () => {
    const touched = new Set();
    for (const g of marks.current) for (const m of g) {
      const parent = m.parentNode;
      if (!parent) continue;
      parent.replaceChild(m.ownerDocument.createTextNode(m.textContent), m);
      touched.add(parent);
    }
    touched.forEach(x => x.normalize());
    marks.current = [];
  };
  const focusHit = (list, i) => {
    const h = list[i], d = docOf();
    if (!h || !d) return;
    unmark();
    const el = show(h.p);
    const needle = term.trim().toLocaleLowerCase('az');
    marks.current = markIn(d, el, needle);
    const g = marks.current[Math.min(h.k, marks.current.length - 1)];
    if (g) { g.forEach(m => m.classList.add('cur')); g[0].scrollIntoView({ block: 'center' }); }
    else el.scrollIntoView({ block: 'start' });
  };
  useEffect(() => {
    if (!ready) return;
    const needle = term.trim().toLocaleLowerCase('az');
    const t = setTimeout(() => {
      unmark();
      if (needle.length < 2) { setHits({ list: [], cur: -1 }); return; }
      if (!texts.current) texts.current = lay.current.pages.map(p => textOfPage(p.html));
      const list = [];
      texts.current.forEach((txt, p) => {
        let k = 0;
        for (let i = txt.indexOf(needle); i >= 0 && list.length < 5000; i = txt.indexOf(needle, i + needle.length)) list.push({ p, k: k++ });
      });
      setHits({ list, cur: list.length ? 0 : -1 });
      if (list.length) focusHit(list, 0);
    }, 250);
    return () => clearTimeout(t);
  }, [term, ready]);   // eslint-disable-line react-hooks/exhaustive-deps
  const step = (dir) => {
    if (!hits.list.length) return;
    const i = (hits.cur + dir + hits.list.length) % hits.list.length;
    setHits(h => ({ ...h, cur: i }));
    focusHit(hits.list, i);
  };
  const openFind = () => { setFinding(true); setTimeout(() => box.current?.select(), 0); };
  const closeFind = () => { setFinding(false); setTerm(''); };
  useEffect(() => {
    const key = (e) => { if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); openFind(); } };
    window.addEventListener('keydown', key);
    const d = ready ? docOf() : null;
    d?.addEventListener('keydown', key);
    return () => { window.removeEventListener('keydown', key); d?.removeEventListener('keydown', key); };
  }, [ready]);   // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <>
      <Bar {...bar} after={<>
        <button className={`vb ${finding ? 'on' : ''}`} onClick={() => (finding ? closeFind() : openFind())} title="Mətndə axtar (Ctrl+F)"><Search size={17} /></button>
        <button className="vb" onClick={printAll} title="Çap et"><Printer size={17} /></button>
        <Downloads doc={doc} word={saved ? null : () => blob} />
        <button className="vb" onClick={bar.onFull} title={bar.full ? 'Tam ekrandan çıx' : 'Tam ekran'}>{bar.full ? <Minimize2 size={17} /> : <Maximize2 size={17} />}</button>
      </>}>
        <><button className={`vb ${thumbs ? 'on' : ''}`} onClick={toggleThumbs} title="Səhifələr"><PanelLeft size={17} /></button><span className="vsep" /></>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronUp size={17} /></button>
          <input className="vpage" value={pageText} inputMode="numeric" aria-label="Səhifə"
            onChange={e => setPageText(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') goPage(pageText); }} onBlur={() => goPage(pageText)} />
          <span className="vof">/ {ready ? pages : '…'}</span>
          <button className="vb" onClick={() => goPage(page + 1)} disabled={page >= pages} title="Növbəti səhifə"><ChevronDown size={17} /></button>
        </div>
        <span className="vsep" />
        <div className="vgroup">
          <button className="vb" onClick={() => zoomStep(-1)} title="Kiçilt"><ZoomOut size={17} /></button>
          <Drop className="vzoom" title="Ölçü" button={<>{shown}%<ChevronDown size={13} /></>}>
            <button onClick={() => setFit(true)}>{fit ? <Check size={14} /> : <i />}Enə sığdır</button>
            <hr />
            {ZOOMS.map(z => <button key={z} onClick={() => zoomTo(z)}>{!fit && zoom === z ? <Check size={14} /> : <i />}{z}%</button>)}
          </Drop>
          <button className="vb" onClick={() => zoomStep(1)} title="Böyüt"><ZoomIn size={17} /></button>
          <button className={`vb ${fit ? 'on' : ''}`} onClick={() => setFit(true)} title="Enə sığdır"><MoveHorizontal size={17} /></button>
        </div>
      </Bar>
      <div className="vbody">
        {!ready && <div className="viewer-state over"><Loader2 size={22} className="spin" /><strong>{busy}</strong><span>{doc.name}</span></div>}
        <iframe ref={frame} className="word-frame docx-frame" title={doc.name} srcDoc={DOCX_FRAME} onLoad={onLoad} style={{ visibility: ready ? 'visible' : 'hidden' }} />
        {finding && (
          <div className="vfind">
            <Search size={15} />
            <input ref={box} value={term} placeholder="Mətndə axtar" autoFocus onChange={e => setTerm(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') closeFind(); }} />
            {term.trim().length >= 2 && <span className="vfind-n">{hits.list.length ? `${hits.cur + 1} / ${hits.list.length}` : 'Tapılmadı'}</span>}
            <button onClick={() => step(-1)} disabled={!hits.list.length} title="Əvvəlki"><ChevronUp size={15} /></button>
            <button onClick={() => step(1)} disabled={!hits.list.length} title="Növbəti"><ChevronDown size={15} /></button>
            <button onClick={closeFind} title="Bağla"><X size={15} /></button>
          </div>
        )}
      </div>
    </>
  );
}

/* ------------------------------ Word, plain reading view ------------------------------ */
function WordView({ blob, doc, bar }) {
  const [parsed, setParsed] = useState(null);
  const [err, setErr] = useState('');
  const [zoom, setZoom] = useState(100);
  const [pages, setPages] = useState(1);
  const [page, setPage] = useState(1);
  const [loaded, setLoaded] = useState(false);
  const frame = useRef(null);
  const docOf = () => frame.current?.contentDocument || null;
  const find = useFrameFind(docOf, loaded);

  useEffect(() => {
    let alive = true;
    setParsed(null); setErr(''); setLoaded(false);
    parseDoc(doc.id, blob, doc.name)
      .then(r => { if (alive) setParsed(r); })
      .catch(e => { if (alive) setErr(e.message); });
    return () => { alive = false; };
  }, [blob, doc.name]);   // eslint-disable-line react-hooks/exhaustive-deps

  const html = useMemo(() => parsed?.html?.replace(/<script[\s\S]*?<\/script>/gi, '').replace('</head>', `<style>${READER_CSS}</style></head>`) || '', [parsed]);

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
      let cur = 1;
      d.querySelectorAll('div.docpage').forEach((p, i) => { if (p.getBoundingClientRect().top < 120) cur = i + 1; });
      setPage(cur);
    }, { passive: true });
    setLoaded(true);
  };

  const goPage = (n) => {
    const v = Math.max(1, Math.min(pages, n));
    docOf()?.getElementById(`page=${v}`)?.scrollIntoView({ block: 'start' });
    setPage(v);
  };

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
        <button className={`vb ${find.finding ? 'on' : ''}`} onClick={find.toggle} title="Mətndə axtar (Ctrl+F)"><Search size={17} /></button>
        <button className="vb" onClick={() => frame.current?.contentWindow?.print()} title="Çap et"><Printer size={17} /></button>
        <Downloads doc={doc} word={() => blob} />
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
      <div className="vbody">
        {!parsed
          ? <div className="viewer-state"><Loader2 size={22} className="spin" /><strong>Sənəd hazırlanır</strong><span>{doc.name}</span></div>
          : <iframe ref={frame} className="word-frame" title={doc.name} sandbox="allow-same-origin allow-modals" srcDoc={html} onLoad={onLoad} />}
        {find.panel}
      </div>
    </>
  );
}
