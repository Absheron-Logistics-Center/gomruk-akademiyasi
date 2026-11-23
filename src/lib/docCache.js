// docCache.js — a Word file is read once and shared: the page that shows it
// and the background PDF maker use the same result instead of reading it twice.
import { GACompat } from './gaParse.js';

const cache = new Map();   // key → Promise of the parsed document
const KEEP = 3;

export function parseDoc(key, blob, name) {
  if (key && cache.has(key)) return cache.get(key);
  const file = blob instanceof File && blob.name === name ? blob : new File([blob], name, { type: blob.type });
  const p = GACompat.read(file, 'document');
  if (key) {
    cache.set(key, p);
    p.catch(() => cache.delete(key));
    while (cache.size > KEEP) cache.delete(cache.keys().next().value);
  }
  return p;
}
export const forgetDoc = (key) => cache.delete(key);
