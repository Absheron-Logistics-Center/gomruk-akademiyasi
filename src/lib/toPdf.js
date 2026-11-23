// toPdf.js — turns a Word / RTF / ODT / old .doc file into a PDF in the browser.
// The text, headings, bold / italic / underline, colours, tables and pictures
// are kept; the file is read with the same reader the site uses everywhere.
import { parseDoc } from './docCache.js';

export const isWordName = (name) => /\.(doc|docx|docm|dot|dotx|dotm|rtf|odt|ott|xml|txt)$/i.test(String(name || ''));

let libs = null;
async function load() {
  if (!libs) {
    libs = Promise.all([
      import('pdfmake/build/pdfmake'),
      import('pdfmake/build/vfs_fonts'),
      import('html-to-pdfmake')
    ]).then(([pm, fonts, h2p]) => {
      const pdfMake = pm.default || pm;
      const vfs = fonts.default?.pdfMake?.vfs || fonts.pdfMake?.vfs || fonts.default?.vfs || fonts.vfs || fonts.default;
      pdfMake.vfs = vfs;
      return { pdfMake, htmlToPdfmake: h2p.default || h2p };
    });
  }
  return libs;
}

const PDF_IMAGE = /^data:image\/(png|jpe?g);base64,/i;

// symbols the PDF font has no shape for: drawn with ones it has
const SWAP = { '→': '->', '←': '<-', '↔': '<->', '⇒': '=>', '⇔': '<=>', '↑': '^', '↓': 'v', '✓': '√', '✔': '√', '✕': '×', '✗': '×', '✘': '×', '☐': '■', '☑': '■', '□': '■', '▪': '•', '▫': '•', '◦': '•', '►': '»', '▶': '»', '◄': '«' };
const SWAP_RE = new RegExp(`[${Object.keys(SWAP).join('')}]`, 'g');
const isEmpty = (el) => !el.querySelector('img') && !el.textContent.replace(/[\s\u00a0]/g, '');

// one HTML page of the reader → pdfmake blocks
function pageBlocks(htmlToPdfmake, html) {
  const doc = new DOMParser().parseFromString(`<div>${html}</div>`, 'text/html');
  // pdfmake can only draw PNG and JPEG pictures
  doc.querySelectorAll('img').forEach(img => { if (!PDF_IMAGE.test(img.getAttribute('src') || '')) img.remove(); });
  doc.querySelectorAll('hr').forEach(hr => hr.replaceWith(doc.createElement('br')));
  // line breaks between table tags would become empty lines in the cells
  doc.querySelectorAll('table, tbody, thead, tr, td, th').forEach(el => {
    for (const n of [...el.childNodes]) if (n.nodeType === 3 && !n.nodeValue.trim()) n.remove();
  });
  // empty paragraphs inside table cells only make rows tall
  doc.querySelectorAll('td p, th p').forEach(p => { if (isEmpty(p)) p.remove(); });
  // more than one empty line in a row becomes one
  doc.querySelectorAll('p').forEach(p => { if (isEmpty(p) && p.previousElementSibling?.tagName === 'P' && isEmpty(p.previousElementSibling)) p.remove(); });
  const walker = doc.createTreeWalker(doc.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) { const t = walker.currentNode; if (SWAP_RE.test(t.nodeValue)) t.nodeValue = t.nodeValue.replace(SWAP_RE, c => SWAP[c]); }
  return htmlToPdfmake(doc.body.firstElementChild.innerHTML, {
    window,
    tableAutoSize: false,
    removeExtraBlanks: true,
    ignoreStyles: ['font-family'],
    defaultStyles: {
      h1: { fontSize: 17, bold: true, color: '#173f55', margin: [0, 10, 0, 6] },
      h2: { fontSize: 14.5, bold: true, color: '#173f55', margin: [0, 9, 0, 5] },
      h3: { fontSize: 12.5, bold: true, color: '#173f55', margin: [0, 8, 0, 4] },
      p: { margin: [0, 0, 0, 6] },
      table: { marginBottom: 8 },
      td: { margin: [4, 3, 4, 3] },
      th: { bold: true, fillColor: '#eef2f6' }
    }
  });
}

// keep pictures and tables inside the page
const CONTENT_W = 595 - 52 * 2;
function fitToPage(node) {
  if (Array.isArray(node)) { node.forEach(fitToPage); return; }
  if (!node || typeof node !== 'object') return;
  if (node.image) {
    delete node.width; delete node.height;
    node.fit = [CONTENT_W, 640];
    node.margin = node.margin || [0, 4, 0, 6];
  }
  if (node.table) {
    const cols = (node.table.body?.[0] || []).reduce((a, c) => a + (c?.colSpan || 1), 0);
    const w = node.table.widths;
    if (cols && (!Array.isArray(w) || w.length !== cols || w.every(x => x === 'auto'))) node.table.widths = Array(cols).fill('*');
    node.table.body?.forEach(row => row.forEach(fitToPage));
  }
  for (const k of ['stack', 'columns', 'ul', 'ol', 'text']) if (Array.isArray(node[k])) node[k].forEach(fitToPage);
}

// the parts of the reader HTML: one string per Word page (page breaks kept)
// long pages are cut into pieces of a few dozen blocks so the site stays responsive
const PIECE = 60;
function pagesOf(fullHtml) {
  const d = new DOMParser().parseFromString(fullHtml, 'text/html');
  const roots = [...d.querySelectorAll('div.docpage')];
  const out = [];
  for (const root of (roots.length ? roots : [d.body])) {
    const kids = [...root.children];
    if (kids.length <= PIECE) { out.push({ html: root.innerHTML, first: true }); continue; }
    for (let i = 0; i < kids.length; i += PIECE) {
      out.push({ html: kids.slice(i, i + PIECE).map(k => k.outerHTML).join(''), first: i === 0 });
    }
  }
  return out;
}

/**
 * file: File or Blob with a name. Returns a PDF Blob.
 * onStep(text) tells what is happening.
 */
export async function wordToPdf(file, onStep = () => {}, key) {
  onStep('Sənəd oxunur');
  const parsed = await parseDoc(key, file, file.name);
  if (parsed.format === 'pdf') return file;
  onStep('PDF qurulur');
  const { pdfMake, htmlToPdfmake } = await load();
  const pages = pagesOf(parsed.html);
  const content = [];
  for (const [i, part] of pages.entries()) {
    const blocks = pageBlocks(htmlToPdfmake, part.html);
    fitToPage(blocks);
    content.push(i && part.first ? { stack: blocks, pageBreak: 'before' } : { stack: blocks });
    if (i % 10 === 9) onStep(`PDF qurulur ${Math.round(((i + 1) / pages.length) * 100)}%`);
    await new Promise(r => setTimeout(r));   // let the page breathe on long files
  }
  const title = String(file.name || 'sened').replace(/\.[^.]+$/, '');
  const def = {
    info: { title, creator: 'Gömrük Akademiyası' },
    pageSize: 'A4',
    pageMargins: [52, 50, 52, 54],
    defaultStyle: { font: 'Roboto', fontSize: 10.5, lineHeight: 1.25, color: '#1f2d36' },
    content
  };
  onStep('PDF səhifələri düzülür');
  return inWorker(def, onStep).catch((e) => {
    // a very old browser without module workers: build it here instead
    if (!/worker/i.test(e?.message || '')) throw e;
    def.footer = (page, count) => ({ text: `${page} / ${count}`, alignment: 'center', fontSize: 8, color: '#8a9ba8', margin: [0, 18, 0, 0] });
    return new Promise((resolve, reject) => {
      try { pdfMake.createPdf(def).getBlob(b => resolve(new Blob([b], { type: 'application/pdf' }))); }
      catch (err) { reject(err); }
    });
  });
}

function inWorker(def, onStep) {
  return new Promise((resolve, reject) => {
    let w;
    try { w = new Worker(new URL('./pdfWorker.js', import.meta.url), { type: 'module' }); }
    catch (e) { reject(new Error(`worker: ${e.message}`)); return; }
    w.onmessage = ({ data }) => {
      if (data.progress !== undefined) onStep(`PDF yazılır ${Math.round(data.progress * 100)}%`);
      else if (data.done) { w.terminate(); resolve(new Blob([data.done], { type: 'application/pdf' })); }
      else if (data.error) { w.terminate(); reject(new Error(data.error)); }
    };
    w.onerror = (e) => { w.terminate(); reject(new Error(`worker: ${e.message || 'PDF qurulmadı'}`)); };
    w.postMessage({ def });
  });
}
