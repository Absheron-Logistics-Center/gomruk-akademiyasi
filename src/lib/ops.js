// ops.js — the steps that change lessons (shared by the add dialog and the folder import).
import { api } from './api.js';
import { uploadFile, extOf, loadDoc } from './files.js';
import { GAWord, GACompat } from './gaParse.js';
import { problemOf } from './tests.js';
import { queuePdf } from './pdfQueue.js';

// Read a Word test bank in the browser; nothing is sent until it reads well.
export async function readTestBank(file) {
  if (extOf(file.name) === 'pdf') throw new Error('PDF test kimi qəbul edilmir. Test bankını Word formatında seçin.');
  const t = await GACompat.read(file, 'test');
  const questions = GAWord.parseQuestions(t.lines);
  if (!questions.length) {
    throw new Error(`${file.name}: sual və variantlar oxunmadı. Nümunə: SUAL: ..., A: ..., B: ..., DÜZGÜN CAVAB: B (və ya düzgün variant qırmızı rənglə).`);
  }
  const blocked = questions.filter(q => problemOf(q)).length;
  return { questions, blocked };
}

// A test bank saved with an older reader may have questions whose answer key was not
// understood. Read its Word file again; if more questions work now, save that for everyone.
export async function rereadBank(owner, tests, questions) {
  const broken = questions.filter(q => problemOf(q)).length;
  if (!broken || !tests?.source) return null;
  const blob = await loadDoc(tests.source);
  const bank = await readTestBank(new File([blob], tests.source.name));
  // keep it only if more questions can be worked now than before
  if (bank.questions.length - bank.blocked <= questions.length - broken) return null;
  await api.saveTests(owner, { questions: bank.questions, keepSource: true });
  return bank.questions;
}

// owner: lesson id or exam id; bank: result of readTestBank
export async function attachTests(owner, file, bank, onProgress) {
  const doc = await uploadFile(file, { owner, section: 'test-source' }, onProgress);
  await api.saveTests(owner, { questions: bank.questions, sourceDocId: doc.id, sourceName: doc.name, sourceSize: doc.size });
  return doc;
}

/**
 * Create a lesson with its documents.
 *   input: { title, originals: File[], explanation: File|null, test: File|null, bank? }
 *   step(label, fraction) is called as work goes on.
 */
export async function createLesson(input, step = () => {}) {
  const files = [...input.originals, input.explanation, input.test].filter(Boolean);
  const total = files.reduce((a, f) => a + f.size, 0) || 1;
  let done = 0;
  const track = (f) => (p) => step(f.name, (done + p * f.size) / total);

  let bank = input.bank || null;
  if (input.test && !bank) { step(`${input.test.name}: suallar oxunur`, 0); bank = await readTestBank(input.test); }

  step('Dərs yaradılır', 0);
  const lesson = await api.addLesson(input.title);
  const errors = [];
  for (const f of input.originals) {
    try { queuePdf(await uploadFile(f, { owner: lesson.id, section: 'original' }, track(f)), f); }
    catch (e) { errors.push(`${f.name}: ${e.message}`); }
    done += f.size;
  }
  if (input.explanation) {
    const f = input.explanation;
    try { queuePdf(await uploadFile(f, { owner: lesson.id, section: 'explanation' }, track(f)), f); }
    catch (e) { errors.push(`${f.name}: ${e.message}`); }
    done += f.size;
  }
  if (input.test && bank) {
    const f = input.test;
    try { await attachTests(lesson.id, f, bank, track(f)); }
    catch (e) { errors.push(`${f.name}: ${e.message}`); }
    done += f.size;
  }
  step('Hazırdır', 1);
  return { lesson, bank, errors };
}

// Group the files of a chosen DERSLER folder into lessons.
// DERSLER/Ders_01/{ORIGINAL,IZAH,TEST}/… and an optional Ders_01/BASLIQ.txt
const OK_DOC = /\.(doc|docx|docm|dot|dotx|dotm|rtf|odt|ott|xml|txt|pdf)$/i;
export async function groupFolder(fileList) {
  const groups = new Map();
  for (const f of fileList) {
    const p = (f.webkitRelativePath || f.name).replace(/\\/g, '/');
    const parts = p.split('/');
    const at = parts.findIndex(seg => /^d[eə]rs[_ -]?\d+$/i.test(seg));
    if (at < 0 || parts.length <= at + 1) continue;
    const dir = parts[at];
    const folder = String(parts[at + 1] || '').toUpperCase();
    if (!groups.has(dir)) groups.set(dir, { dir, originals: [], explanation: [], tests: [], titleFile: null });
    const g = groups.get(dir);
    const name = parts[parts.length - 1];
    if (parts.length === at + 2 && /^BASLIQ\.txt$/i.test(name)) { g.titleFile = f; continue; }
    if (/^_/.test(name) || !OK_DOC.test(name)) continue;
    if (folder === 'ORIGINAL' || folder === 'ORIJINAL') g.originals.push(f);
    else if (folder === 'IZAH' || folder === 'EXPLANATION') g.explanation.push(f);
    else if (folder === 'TEST') g.tests.push(f);
  }
  const num = (d) => Number(d.match(/\d+/)?.[0] || 0);
  const out = [];
  for (const g of [...groups.values()].sort((a, b) => num(a.dir) - num(b.dir))) {
    const byName = (a, b) => a.name.localeCompare(b.name, 'az', { numeric: true });
    // when a Word file also has a PDF copy with the same name, the PDF shows
    // the real layout, so the PDF is used and the Word copy is skipped
    const pick = (list) => {
      const pdfStems = new Set(list.filter(f => extOf(f.name) === 'pdf').map(f => f.name.replace(/\.[^.]+$/, '').toLowerCase()));
      const skipped = [];
      const keep = list.filter(f => {
        if (extOf(f.name) !== 'pdf' && pdfStems.has(f.name.replace(/\.[^.]+$/, '').toLowerCase())) { skipped.push(f.name); return false; }
        return true;
      }).sort(byName);
      return { keep, skipped };
    };
    const o = pick(g.originals);
    const x = pick(g.explanation);
    const tests = g.tests.filter(f => extOf(f.name) !== 'pdf').sort(byName);
    let title = '';
    if (g.titleFile) { try { title = (await g.titleFile.text()).replace(/^﻿/, '').trim().split(/\r?\n/)[0].slice(0, 250); } catch { /* ignore */ } }
    if (!title) title = g.dir.replace(/[_-]+/g, ' ');
    if (!o.keep.length && !x.keep.length && !tests.length) continue;
    out.push({
      dir: g.dir, title,
      originals: o.keep,
      explanation: x.keep[0] || null,
      extraExplanation: x.keep.slice(1).map(f => f.name),
      test: tests[0] || null,
      extraTests: tests.slice(1).map(f => f.name),
      skipped: [...o.skipped, ...x.skipped]
    });
  }
  return out;
}
