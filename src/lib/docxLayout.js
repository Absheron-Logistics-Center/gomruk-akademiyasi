// docxLayout.js — shows a Word (.docx) file the way Word lays it out: page size,
// margins, fonts, alignment, tables, headers and footers, pictures.
// Old binary .doc files and files it cannot read fall back to the plain reader.
let libP = null;
const lib = () => (libP ||= import('docx-preview'));

export const LAYOUT = {
  className: 'docx',
  inWrapper: true,
  breakPages: true,
  ignoreLastRenderedPageBreak: false,   // break pages where Word did
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

// Word saves where its pages ended only after the file was opened in Word; files made by
// other programs come as one long page. Cut such pages at the page height, like Word does.
export function paginate(d) {
  const wrap = d.querySelector('.docx-wrapper');
  if (!wrap) return 0;
  let sec = wrap.querySelector(':scope > section.docx');
  let guard = 0;
  while (sec && guard++ < 5000) {
    const art = sec.querySelector(':scope > article');
    const cs = d.defaultView.getComputedStyle(sec);
    const pageH = parseFloat(cs.minHeight) || 0;
    if (art && pageH > 200) {
      const head = sec.querySelector(':scope > header'), foot = sec.querySelector(':scope > footer');
      let avail = pageH - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom) - (head?.offsetHeight || 0) - (foot?.offsetHeight || 0);
      if (avail < pageH * 0.4) avail = pageH * 0.6;
      const top = art.getBoundingClientRect().top;
      const kids = [...art.children];
      let cut = kids.findIndex(k => k.getBoundingClientRect().bottom - top > avail + 1);
      if (cut >= 0) {
        let carry = null;
        const el = kids[cut];
        if (el.tagName === 'TABLE') carry = splitTable(d, el, top, avail, cut === 0);
        if (!carry && cut === 0) cut = 1;           // one block taller than a page: keep it whole
        const moved = kids.slice(carry ? cut + 1 : cut);
        if (carry || moved.length) {
          const next = sec.cloneNode(false);
          if (head) next.appendChild(head.cloneNode(true));
          const na = art.cloneNode(false);
          next.appendChild(na);
          if (foot) next.appendChild(foot.cloneNode(true));
          if (carry) na.appendChild(carry);
          moved.forEach(k => na.appendChild(k));
          sec.after(next);
        }
      }
    }
    sec = sec.nextElementSibling?.matches('section.docx') ? sec.nextElementSibling : null;
  }
  const all = wrap.querySelectorAll(':scope > section.docx');
  numberPages(all);
  return all.length;
}

// rows past the end of the page go into a copy of the table on the next page
function splitTable(d, tbl, top, avail, first) {
  const body = tbl.tBodies[0] || tbl;
  const rows = [...body.children].filter(r => r.tagName === 'TR');
  let at = rows.findIndex(r => r.getBoundingClientRect().bottom - top > avail + 1);
  if (at < 0) return null;
  if (at === 0) { if (!first) return null; at = 1; }   // the whole table moves, unless it already starts the page
  if (at >= rows.length) return null;
  const copy = tbl.cloneNode(false);
  for (const c of tbl.children) if (c.tagName === 'COLGROUP' || c.tagName === 'THEAD') copy.appendChild(c.cloneNode(true));
  const nb = (body === tbl ? copy : copy.appendChild(body.cloneNode(false)));
  rows.slice(at).forEach(r => nb.appendChild(r));
  return copy;
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
