// Reader.jsx — opens a stored document in the browser's own PDF viewer.
// A Word file is shown as its PDF copy (made automatically in the background);
// until that copy exists it is shown as a readable page with search, pages and zoom.
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize2, Download, ExternalLink, Search, MoveHorizontal,
  Loader2, AlertTriangle, ChevronUp, ChevronDown, X, RotateCw, FileDown
} from 'lucide-react';
import { Progress } from './ui.jsx';
import '../styles/pdf-text.css';
import { loadDoc, saveBlob, isPdf, fmtSize } from '../lib/files.js';
import { GACompat } from '../lib/gaParse.js';
import { queuePdf, subscribe, retryPdf } from '../lib/pdfQueue.js';

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

  const pdf = isPdf(doc.name) || variant === 'pdf';
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
          <span>{doc.name} · {fmtSize(variant ? doc.pdf.size : doc.size)}</span>
          <div className="reader-progress"><Progress value={progress} /></div>
        </div>
      ) : pdf ? (
        <PdfView blob={blob} doc={doc} onFull={fullscreen} extra={extra} fromWord={!!variant} />
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
// The site's own PDF viewer (pdf.js): pages drawn as pictures with a text
// layer on top, so text can be selected and searched. Loaded only when a PDF opens.
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

function PdfView({ blob, doc, onFull, extra, fromWord }) {
  const pdfName = fromWord ? `${doc.name.replace(/\.[^.]+$/, '')}.pdf` : doc.name;
  const url = useObjectUrl(blob, 'application/pdf');
  const scroller = useRef(null);
  const [pdf, setPdf] = useState(null);
  const [lib, setLib] = useState(null);
  const [base, setBase] = useState(null);          // first page size at 100%
  const [err, setErr] = useState('');
  const [fit, setFit] = useState(true);
  const [zoom, setZoom] = useState(100);
  const [width, setWidth] = useState(0);
  const [page, setPage] = useState(1);
  const [pageText, setPageText] = useState('1');
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

  // follow the width of the viewer (fit to width)
  useEffect(() => {
    const el = scroller.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, [pdf]);

  const scale = !base ? 1 : fit ? Math.max(0.3, Math.min(4, (width - 40) / base.w)) : zoom / 100;
  const shownZoom = Math.round(scale * 100);

  // which page is on screen
  const onScroll = () => {
    const el = scroller.current;
    if (!el) return;
    const mid = el.scrollTop + el.clientHeight * 0.35;
    let cur = 1;
    for (const node of el.querySelectorAll('.pdf-page')) { if (node.offsetTop <= mid) cur = Number(node.dataset.n); else break; }
    if (cur !== page) { setPage(cur); setPageText(String(cur)); }
  };
  const goPage = (n) => {
    if (!pdf) return;
    const v = Math.max(1, Math.min(pdf.numPages, Math.floor(Number(n) || 1)));
    setPage(v); setPageText(String(v));
    const el = scroller.current, node = el?.querySelector(`.pdf-page[data-n="${v}"]`);
    if (el && node) el.scrollTop = node.offsetTop - 12;   // only the viewer scrolls, never the whole page
  };
  const setZoomFrom = (next) => { setFit(false); setZoom(Math.max(40, Math.min(400, next))); };

  // search the text of every page
  async function pageText_(n) {
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
        const text = await pageText_(n);
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

  const downloadWord = async () => {
    setGettingWord(true);
    try { saveBlob(await loadDoc(doc), doc.name); } catch { /* shown by the browser */ } finally { setGettingWord(false); }
  };

  return (
    <>
      <div className="reader-bar">
        <div className="reader-name" title={pdfName}><span className="ftype pdf">PDF</span><span>{pdfName}</span></div>
        <div className="reader-search">
          <Search size={15} />
          <input value={term} placeholder="Mətndə axtar" onChange={e => setTerm(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') step(e.shiftKey ? -1 : 1); if (e.key === 'Escape') setTerm(''); }} />
          {term.trim().length >= 2 && <span className="hit-count">{hits.busy ? '...' : hits.list.length ? `${hits.cur + 1} / ${hits.list.length}` : 'Tapılmadı'}</span>}
          {term && <>
            <button className="tool sm" onClick={() => step(-1)} disabled={!hits.list.length} title="Əvvəlki"><ChevronUp size={15} /></button>
            <button className="tool sm" onClick={() => step(1)} disabled={!hits.list.length} title="Növbəti"><ChevronDown size={15} /></button>
            <button className="tool sm" onClick={() => setTerm('')} title="Təmizlə"><X size={14} /></button>
          </>}
        </div>
        <div className="tool-group">
          <button className="tool" onClick={() => goPage(page - 1)} disabled={page <= 1} title="Əvvəlki səhifə"><ChevronLeft size={16} /></button>
          <input className="page-input" value={pageText} inputMode="numeric" aria-label="Səhifə"
            onChange={e => setPageText(e.target.value.replace(/\D/g, ''))}
            onKeyDown={e => { if (e.key === 'Enter') goPage(pageText); }} onBlur={() => goPage(pageText)} />
          <span className="tool-label of">/ {pdf?.numPages || '…'}</span>
          <button className="tool" onClick={() => goPage(page + 1)} disabled={!pdf || page >= pdf.numPages} title="Növbəti səhifə"><ChevronRight size={16} /></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={() => setZoomFrom(shownZoom - 15)} title="Kiçilt"><ZoomOut size={16} /></button>
          <span className="tool-label">{fit ? 'Eninə' : `${shownZoom}%`}</span>
          <button className="tool" onClick={() => setZoomFrom(shownZoom + 15)} title="Böyüt"><ZoomIn size={16} /></button>
          <button className={`tool ${fit ? 'on' : ''}`} onClick={() => setFit(f => !f)} title="Eninə yerləşdir"><MoveHorizontal size={16} /></button>
        </div>
        <div className="tool-group">
          <button className="tool" onClick={onFull} title="Tam ekran"><Maximize2 size={16} /></button>
          <a className="tool" href={url || undefined} target="_blank" rel="noopener" title="Yeni pəncərədə aç"><ExternalLink size={16} /></a>
          <button className="tool" onClick={() => saveBlob(blob, pdfName)} title="PDF-i endir"><Download size={16} /></button>
          {fromWord && (
            <button className="tool" onClick={downloadWord} disabled={gettingWord} title="Word orijinalını endir">
              {gettingWord ? <Loader2 size={16} className="spin" /> : <FileDown size={16} />}
            </button>
          )}
        </div>
        {extra}
      </div>
      <div className="pdf-scroller" ref={scroller} onScroll={onScroll}>
        {err ? <div className="reader-state bad"><AlertTriangle size={22} /><strong>PDF açılmadı</strong><span>{err}</span></div>
          : !pdf || !base ? <div className="reader-state"><Loader2 size={22} className="spin" /><strong>Səhifələr hazırlanır</strong></div>
            : Array.from({ length: pdf.numPages }, (_, i) => (
              <PdfPage key={i + 1} lib={lib} pdf={pdf} n={i + 1} scale={scale} base={base} root={scroller}
                term={term.trim().length >= 2 ? lowerAz(term.trim()) : ''} current={hits.list[hits.cur] === i + 1} />
            ))}
      </div>
    </>
  );
}

// one page: drawn when it comes near the screen
function PdfPage({ lib, pdf, n, scale, base, root, term, current }) {
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
      const v1 = p.getViewport({ scale: 1 });
      setSize({ w: v1.width, h: v1.height });
      const vp = p.getViewport({ scale });
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
  }, [near, scale, pdf, n, lib]);

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
      <PdfProgress doc={doc} />
      <iframe ref={frame} className="reader-frame word" title={doc.name} sandbox="allow-same-origin" srcDoc={html} onLoad={onLoad} />
      <div className="reader-note">Word sənədinin brauzerdə sadələşdirilmiş görünüşüdür. Orijinal rəng, qrafik və tərtibat üçün faylı endirin.</div>
    </>
  );
}
