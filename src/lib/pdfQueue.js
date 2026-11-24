// pdfQueue.js — nothing is converted in the browser any more.
// Word files: the viewer lays a file out the first time it is opened and saves those pages
// (one render, no second copy in the background), and the exact PDF is made by Microsoft
// Word on the company server. These names stay so the rest of the site does not change.
const listeners = new Set();
export const snapshot = () => [];
export function subscribe(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }
export const isQueued = () => false;
export const jobOf = () => null;
export function queuePdf() { /* the company server makes PDFs */ }
export function retryPdf() { /* nothing to retry here */ }
export const noteActivity = () => {};
