// pdfWorker.js — lays out and draws the PDF away from the page, so the site
// never freezes while a long Word file becomes a PDF.
import pdfMakeLib from 'pdfmake/build/pdfmake';
import * as fonts from 'pdfmake/build/vfs_fonts';

const pdfMake = pdfMakeLib.default || pdfMakeLib;
pdfMake.vfs = fonts.default?.pdfMake?.vfs || fonts.pdfMake?.vfs || fonts.default?.vfs || fonts.vfs || fonts.default;

self.onmessage = ({ data }) => {
  const def = data.def;
  def.footer = (page, count) => ({ text: `${page} / ${count}`, alignment: 'center', fontSize: 8, color: '#8a9ba8', margin: [0, 18, 0, 0] });
  try {
    let last = 0;
    pdfMake.createPdf(def).getBuffer((buf) => {
      const out = buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength);
      self.postMessage({ done: out }, [out]);
    }, {
      progressCallback: (p) => {
        const n = Math.round(p * 100);
        if (n !== last) { last = n; self.postMessage({ progress: p }); }
      }
    });
  } catch (e) {
    self.postMessage({ error: e?.message || String(e) });
  }
};
