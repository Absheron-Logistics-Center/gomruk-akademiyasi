// docxLayout.js — shows a Word (.docx) file the way Word lays it out: page size,
// margins, fonts, alignment, tables, headers and footers, pictures.
// Old binary .doc files and files it cannot read fall back to the plain reader.
let libP = null;
const lib = () => (libP ||= import('docx-preview'));

export const LAYOUT = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  // every Word section gets its own page with its own size (portrait or landscape);
  // pages are then cut by height in paginate(), like Word does
  ignoreLastRenderedPageBreak: true,
  ignoreWidth: false,
  ignoreHeight: false,
  ignoreFonts: false,
  renderHeaders: true,
  renderFooters: true,
  renderFootnotes: true,
  renderEndnotes: true,
  useBase64URL: true,
  experimental: true,
  trimXmlDeclaration: true
};

// a .docx is a zip file; many files named .doc are .docx inside
export async function isZip(blob) {
  const b = new Uint8Array(await blob.slice(0, 4).arrayBuffer());
  return b[0] === 0x50 && b[1] === 0x4b && b[2] === 0x03 && b[3] === 0x04;
}

// true when the file can be shown with its Word layout (then no PDF copy is needed)
export async function canLayout(blob) {
  if (!blob || !await isZip(blob)) return false;
  try {
    const L = await lib();
    const d = await L.parseAsync(blob, LAYOUT);
    return !!d?.documentPart?.body?.children?.length;
  } catch { return false; }
}

export async function renderDocx(blob, body, head) {
  const L = await lib();
  await L.renderAsync(await markPageFields(blob), body, head, LAYOUT);
}

// Page number fields ("Səhifə 3 / 30") are not drawn by the layout engine. Put a
// marker in their place in the headers and footers; paginate() writes the numbers.
const PAGE_MARK = '\u27E6PAGE\u27E7', PAGES_MARK = '\u27E6PAGES\u27E7';
async function markPageFields(blob) {
  try {
    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(blob);
    let changed = false;
    for (const name of Object.keys(zip.files)) {
      if (!/^word\/(header|footer)\d*\.xml$/i.test(name)) continue;
      const xml = await zip.file(name).async('string');
      const out = fieldsToMarks(xml);
      if (out !== xml) { zip.file(name, out); changed = true; }
    }
    return changed ? await zip.generateAsync({ type: 'blob' }) : blob;
  } catch { return blob; }
}
function markRun(rPr, which) {
  return `<w:r>${rPr || ''}<w:t xml:space="preserve">${which === 'NUMPAGES' || which === 'SECTIONPAGES' ? PAGES_MARK : PAGE_MARK}</w:t></w:r>`;
}
function fieldsToMarks(xml) {
  // simple fields: <w:fldSimple w:instr=" PAGE "> ... </w:fldSimple>
  xml = xml.replace(/<w:fldSimple\b[^>]*w:instr="\s*(PAGE|NUMPAGES|SECTIONPAGES)\b[^"]*"[^>]*?(?:\/>|>([\s\S]*?)<\/w:fldSimple>)/g,
    (m, which, inner, at, all) => markRun((inner || '').match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0] || lastRunLook(all, at), which));
  // complex fields: begin … instrText PAGE … separate … result … end, spread over several runs
  return xml.replace(/<w:r\b[^>]*>(?:(?!<\/w:r>)[\s\S])*?<w:fldChar\b[^>]*w:fldCharType="begin"[\s\S]*?<w:fldChar\b[^>]*w:fldCharType="end"[^>]*\/>(?:(?!<w:r\b)[\s\S])*?<\/w:r>/g, (m) => {
    if ((m.match(/w:fldCharType="begin"/g) || []).length > 1) return m;        // nested fields: leave alone
    const ins = /<w:instrText\b[^>]*>\s*(PAGE|NUMPAGES|SECTIONPAGES)\b/.exec(m);
    if (!ins) return m;
    return markRun(m.match(/<w:rPr>[\s\S]*?<\/w:rPr>/)?.[0], ins[1]);
  });
}
// a field without its own look takes the look of the text just before it in the same paragraph
function lastRunLook(xml, at) {
  const before = xml.slice(Math.max(0, xml.lastIndexOf('<w:p', at)), at);
  const all = before.match(/<w:r\b[^>]*>\s*<w:rPr>[\s\S]*?<\/w:rPr>/g);
  return all ? all[all.length - 1].replace(/^<w:r\b[^>]*>\s*/, '') : '';
}

// Pages are cut at the page height, like Word does. Footnotes go to the bottom of
// the page where they are referred to (the layout engine puts them all at the end).
// Everything is measured first and moved afterwards, so a long file is cut quickly.
export function paginate(d) {
  const wrap = d.querySelector('.docx-wrapper');
  if (!wrap) return 0;
  const noteH = new Map();          // footnote id -> height
  let nextId = 0;

  // take the footnote lists out; mark each reference and its note with the same id.
  // A list holds the notes of all references since the previous list.
  let pending = [];
  const pool = new Map();
  for (const sec of wrap.querySelectorAll(':scope > section.docx')) {
    sec.querySelectorAll(':scope > article sup').forEach(x => pending.push(x));
    const lists = [...sec.querySelectorAll(':scope > ol')];
    if (!lists.length) continue;
    const items = [...lists[0].children].filter(li => li.tagName === 'LI');
    let k = 1;
    for (const sup of pending) {
      if (k > items.length) break;
      if (sup.textContent.trim() !== String(k)) continue;
      const id = `n${nextId++}`;
      sup.dataset.fn = id;
      items[k - 1].dataset.fn = id;
      items[k - 1].value = k;
      const li = items[k - 1], lr = li.getBoundingClientRect();
      const ps = [...li.children];
      const parts = ps.map((el, j) => ({ el, h: (j + 1 < ps.length ? ps[j + 1].getBoundingClientRect().top : lr.bottom) - el.getBoundingClientRect().top }));
      noteH.set(id, lr.height);
      pool.set(id, { li, k, parts: parts.length ? parts : [{ el: null, h: lr.height }] });
      k++;
    }
    pending = [];
  }
  wrap.querySelectorAll(':scope > section.docx > ol').forEach(ol => { if ([...ol.children].some(li => li.dataset.fn)) ol.remove(); });
  let noteCap = Infinity;            // a long note continues on the next pages, like in Word
  const notesIn = (el) => {
    let h = 0;
    el.querySelectorAll('sup[data-fn]').forEach(x => { h += Math.min(noteCap, noteH.get(x.dataset.fn) || 0); });
    return h;
  };
  const availOf = new Map();
  const NOTE_GAP = 18;

  for (const sec of [...wrap.querySelectorAll(':scope > section.docx')]) {
    const art = sec.querySelector(':scope > article');
    const cs = d.defaultView.getComputedStyle(sec);
    const pageH = parseFloat(cs.minHeight) || 0;
    if (!art || pageH < 200) continue;
    const head = sec.querySelector(':scope > header'), foot = sec.querySelector(':scope > footer');
    let avail = pageH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (head?.offsetHeight || 0) - (foot?.offsetHeight || 0);
    if (avail < pageH * 0.4) avail = pageH * 0.6;
    availOf.set(sec, avail);
    noteCap = avail * 0.35;

    // read: where every block (and every table row) ends
    const top = art.getBoundingClientRect().top;
    const kids = [...art.children];
    const box = kids.map(k => { const r = k.getBoundingClientRect(); return { t: r.top - top, b: r.bottom - top, n: notesIn(k) }; });
    if (!box.length || box[box.length - 1].b <= avail) continue;
    const rowsOf = new Map();
    kids.forEach((k, i) => {
      if (k.tagName !== 'TABLE' || box[i].b - box[i].t < 40) return;
      const body = k.tBodies[0] || k;
      const rows = [...body.children].filter(r => r.tagName === 'TR');
      rowsOf.set(k, { body, rows, box: rows.map(r => { const q = r.getBoundingClientRect(); return { t: q.top - top, b: q.bottom - top, n: notesIn(r) }; }) });
    });

    // plan: which blocks (or row ranges of a table) go on which page
    const pages = [[]];
    let start = box[0].t, notes = 0;
    const over = (bottom, extra) => bottom - start + (notes + extra ? notes + extra + NOTE_GAP : 0) > avail + 1;
    const newPage = (y) => { pages.push([]); start = y; notes = 0; };
    kids.forEach((k, i) => {
      const cur = pages[pages.length - 1];
      if (!over(box[i].b, box[i].n)) { cur.push({ el: k }); notes += box[i].n; return; }
      const t = rowsOf.get(k);
      if (t && t.rows.length > 1) {
        // a table across the page end: its rows continue on the next page
        let from = 0;
        for (let r = 0; r < t.rows.length; r++) {
          if (!over(t.box[r].b, t.box[r].n)) { notes += t.box[r].n; continue; }
          if (r > from) pages[pages.length - 1].push({ el: k, rows: [from, r] });
          else if (pages[pages.length - 1].length === 0) { notes += t.box[r].n; continue; }   // one row taller than a page
          newPage(t.box[r].t);
          from = r;
          notes += t.box[r].n;
        }
        pages[pages.length - 1].push({ el: k, rows: [from, t.rows.length] });
        return;
      }
      if (cur.length) newPage(box[i].t);
      pages[pages.length - 1].push({ el: k });
      notes += box[i].n;
    });
    if (pages.length < 2) continue;

    // write: build the pages after this one
    let after = sec;
    pages.forEach((items, p) => {
      let target = art;
      if (p > 0) {
        const page = sec.cloneNode(false);
        if (head) page.appendChild(head.cloneNode(true));
        target = art.cloneNode(false);
        page.appendChild(target);
        if (foot) page.appendChild(foot.cloneNode(true));
        after.after(page);
        after = page;
        availOf.set(page, avail);
      }
      for (const it of items) {
        if (!it.rows) { if (p > 0) target.appendChild(it.el); continue; }
        const t = rowsOf.get(it.el);
        if (it.rows[0] === 0) { if (p > 0) target.appendChild(it.el); continue; }   // the first piece keeps the table itself
        const copy = it.el.cloneNode(false);
        for (const c of it.el.children) if (c.tagName === 'COLGROUP' || c.tagName === 'THEAD') copy.appendChild(c.cloneNode(true));
        const nb = t.body === it.el ? copy : copy.appendChild(t.body.cloneNode(false));
        t.rows.slice(it.rows[0], it.rows[1]).forEach(r => nb.appendChild(r));
        target.appendChild(copy);
      }
    });
  }

  // footnotes: each page takes the notes of its own references at its bottom; a note
  // that does not fit continues at the bottom of the next page (and the next...)
  const pagesNow = [...wrap.querySelectorAll(':scope > section.docx')];
  const used = pagesNow.map(pg => pg.querySelector(':scope > article')?.getBoundingClientRect().height || 0);   // one read
  let carry = [];                  // [{ note, from }] parts still to place
  const plan = pagesNow.map((pg, i) => {
    const own = [...pg.querySelectorAll(':scope > article sup[data-fn]')].map(r => pool.get(r.dataset.fn)).filter(Boolean);
    const queue = [...carry, ...own.map(note => ({ note, from: 0 }))];
    carry = [];
    const avail = availOf.get(pg);
    if (!queue.length || !avail) { carry = queue; return []; }
    let room = avail - used[i] - NOTE_GAP;
    const out = [];
    for (let q = 0; q < queue.length; q++) {
      const { note, from } = queue[q];
      let to = from;
      while (to < note.parts.length && (room - note.parts[to].h >= 0 || (to === from && !out.length && room > avail * 0.15))) { room -= note.parts[to].h; to++; }
      if (to > from) out.push({ note, from, to });
      if (to < note.parts.length) { carry = [{ note, from: to }, ...queue.slice(q + 1)]; break; }
    }
    return out;
  });
  // notes left over at the end: pages with notes only
  let last = pagesNow[pagesNow.length - 1];
  while (carry.length && last) {
    const page = last.cloneNode(false);
    const head = last.querySelector(':scope > header'), foot = last.querySelector(':scope > footer');
    if (head) page.appendChild(head.cloneNode(true));
    page.appendChild(d.createElement('article'));
    if (foot) page.appendChild(foot.cloneNode(true));
    last.after(page);
    const avail = availOf.get(last) || 900;
    let room = avail - NOTE_GAP;
    const out = [];
    const queue = carry; carry = [];
    for (let q = 0; q < queue.length; q++) {
      const { note, from } = queue[q];
      let to = from;
      while (to < note.parts.length && (room - note.parts[to].h >= 0 || to === from)) { room -= note.parts[to].h; to++; }
      out.push({ note, from, to });
      if (to < note.parts.length) { carry = [{ note, from: to }, ...queue.slice(q + 1)]; break; }
    }
    pagesNow.push(page); plan.push(out); availOf.set(page, avail);
    last = page;
  }
  pagesNow.forEach((pg, i) => {
    if (!plan[i]?.length) return;
    const ol = d.createElement('ol');
    ol.className = 'ga-notes';
    for (const { note, from, to } of plan[i]) {
      let li;
      if (from === 0) { li = note.li; }
      else { li = d.createElement('li'); li.className = 'ga-cont'; }
      if (note.parts[0].el) for (let j = from; j < to; j++) li.appendChild(note.parts[j].el);
      ol.appendChild(li);
    }
    pg.insertBefore(ol, pg.querySelector(':scope > footer') || null);
  });

  const all = wrap.querySelectorAll(':scope > section.docx');
  numberPages(all);
  return all.length;
}

// page number fields in headers and footers show their own page
function numberPages(sections) {
  const total = String(sections.length);
  sections.forEach((s, i) => {
    s.querySelectorAll(':scope > header, :scope > footer').forEach(h => {
      const walker = h.ownerDocument.createTreeWalker(h, NodeFilter.SHOW_TEXT);
      while (walker.nextNode()) {
        const n = walker.currentNode;
        if (n.nodeValue.includes('\u27E6')) n.nodeValue = n.nodeValue.split(PAGE_MARK).join(String(i + 1)).split(PAGES_MARK).join(total);
      }
    });
  });
}

// the look of the pages inside the viewer frame (also saved with a ready layout)
const FRAME_CSS = `
  mark.ga-hit{background:#fde68a;color:inherit;border-radius:2px;padding:0 1px}
  mark.ga-hit.cur{background:#f59e0b;color:#fff;box-shadow:0 0 0 2px rgba(245,158,11,.35)}
  ::-webkit-scrollbar{width:10px;height:10px}::-webkit-scrollbar-track{background:transparent}
  ::-webkit-scrollbar-thumb{background:#b9c9d2;border-radius:10px;border:3px solid transparent;background-clip:content-box}
  ::-webkit-scrollbar-thumb:hover{background-color:#94abb8}::-webkit-scrollbar-button{display:none;width:0;height:0}
`;
export const DOCX_LOOK = `
  html,body{margin:0;background:#e9eef1}
  .docx-wrapper>section.docx{display:flex;flex-direction:column}
  .docx-wrapper>section.docx>article{flex:none}
  .docx-wrapper>section.docx>footer{margin-top:auto}
  .docx-wrapper>section.docx>ol.ga-notes{margin:auto 0 0;padding:8px 0 0 1.6em;position:relative}
  .docx-wrapper>section.docx>ol.ga-notes::before{content:'';position:absolute;left:0;top:0;width:33%;border-top:1px solid #000}
  .docx-wrapper>section.docx>ol.ga-notes+footer{margin-top:0}
  .docx-wrapper>section.docx>ol.ga-notes>li.ga-cont{list-style:none}
  .ga-thumbs{position:fixed;left:0;top:0;bottom:0;width:150px;box-sizing:border-box;overflow-y:auto;background:#f6f8fa;border-right:1px solid #dbe4e9;padding:16px 0 24px;display:none;flex-direction:column;align-items:center;gap:14px;z-index:5}
  body.thumbs-open{padding-left:150px}
  body.thumbs-open .ga-thumbs{display:flex}
  .ga-thumb{display:flex;flex-direction:column;align-items:center;gap:6px;border:0;background:none;cursor:pointer;padding:0;font:500 11.5px Inter,system-ui,sans-serif;color:#8a9ba8;flex-shrink:0}
  .ga-thumb-img{display:block;position:relative;overflow:hidden;background:#fff;border:1px solid #dbe4e9;outline:2.5px solid transparent;outline-offset:2px;transition:outline-color .12s}
  .ga-thumb:hover .ga-thumb-img{outline-color:#9fc2d3}
  .ga-thumb.on .ga-thumb-img{outline-color:#3a7894}
  .ga-thumb.on{color:#2c5d75;font-weight:650}
  .docx-wrapper{background:transparent!important;padding:24px 24px 40px!important;display:flex;flex-flow:column;align-items:safe center;width:max-content;min-width:100%;box-sizing:border-box;transform-origin:0 0}
  .docx-wrapper>section.docx{box-shadow:0 1px 3px rgba(20,60,80,.1),0 10px 30px rgba(20,60,80,.08)!important;margin:0 0 16px!important;flex-shrink:0}
  ${FRAME_CSS}
  @page{margin:0}
  @media print{
    html,body{background:#fff!important}
    .docx-wrapper{padding:0!important;zoom:1!important;background:none!important;display:block!important;width:auto!important}
    .docx-wrapper>section.docx{box-shadow:none!important;margin:0!important;break-after:page}
    .ga-thumbs{display:none!important}body{padding-left:0!important}
    mark.ga-hit{background:none!important;color:inherit!important;box-shadow:none!important}
  }
`;

/* ---------- ready layouts: laid out once, opened at once ever after ---------- */
// A layout is the document's styles plus every page as its own piece of HTML with its size.
// The viewer puts only the pages near the screen into the page, so even a 200-page law
// uses little memory.
export const LAYOUT_V = 'L3';
export const canSaveLayout = () => typeof CompressionStream === 'function' && typeof DecompressionStream === 'function';

export async function pack(data) {
  const gz = new Blob([JSON.stringify(data)]).stream().pipeThrough(new CompressionStream('gzip'));
  return new Response(gz).blob();
}
export async function unpack(blob) {
  try {
    const data = JSON.parse(await new Response(blob.stream().pipeThrough(new DecompressionStream('gzip'))).text());
    return data?.v === LAYOUT_V && Array.isArray(data.pages) && data.pages.length ? data : null;
  } catch { return null; }
}

// lay a Word file out once in a hidden frame and take it apart into pages
export async function layOut(blob) {
  const f = document.createElement('iframe');
  f.setAttribute('aria-hidden', 'true');
  f.style.cssText = 'position:fixed;left:-20000px;top:0;width:1200px;height:900px;border:0;visibility:hidden;pointer-events:none';
  f.srcdoc = '<!doctype html><html><head><meta charset="utf-8"></head><body></body></html>';
  const loaded = new Promise(r => { f.onload = r; });
  document.body.appendChild(f);
  try {
    await loaded;
    const d = f.contentDocument;
    await renderDocx(blob, d.body, d.head);
    addLook(d);
    if (!d.querySelector('.docx-wrapper > section.docx') || !(d.body.textContent || '').trim()) throw new Error('Sənəddə mətn yoxdur');
    paginate(d);
    d.getElementById('ga-look')?.remove();
    const secs = [...d.querySelectorAll('.docx-wrapper > section.docx')];
    addLook(d);
    const sizes = secs.map(x => [x.offsetWidth, x.offsetHeight]);
    d.getElementById('ga-look')?.remove();
    return {
      v: LAYOUT_V,
      head: d.head.innerHTML,
      pages: secs.map((x, i) => ({ w: sizes[i][0], h: sizes[i][1], html: x.outerHTML }))
    };
  } finally {
    try { f.contentDocument.body.replaceChildren(); f.contentDocument.head.replaceChildren(); } catch { /* gone */ }
    f.src = 'about:blank';
    f.remove();
  }
}

// the plain text of one page, for searching
export function pageText(html) {
  return html.replace(/<(style|script)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, '')
    .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&')
    .toLocaleLowerCase('az');
}

export const isComputer = () => !!window.matchMedia?.('(pointer: fine)').matches && window.innerWidth >= 900;

export function addLook(d) {
  if (d.getElementById('ga-look')) return;
  const st = d.createElement('style');
  st.id = 'ga-look';
  st.textContent = DOCX_LOOK;
  d.head.appendChild(st);
}
