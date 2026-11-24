// convert.js — turns Word files into PDFs with Microsoft Word itself (on Windows), so the
// PDF looks exactly like the document in Word. Without Word, LibreOffice is used if it
// is installed. Nothing else changes the look of a document.
import { execFile } from 'child_process';
import fs from 'fs/promises';
import path from 'path';
import os from 'os';

const run = (cmd, args, ms) => new Promise((resolve) => {
  execFile(cmd, args, { timeout: ms, windowsHide: true, maxBuffer: 8 * 1024 * 1024 }, (error, stdout, stderr) => {
    resolve({ error, stdout: String(stdout || ''), stderr: String(stderr || '') });
  });
});

// Word opens each file read-only, saves it as PDF (17 = wdExportFormatPDF) and closes it.
// One Word for the whole list; the result of each file goes to <list>.out.
const WORD_PS1 = `
param([string]$list)
$ErrorActionPreference = 'Stop'
$items = Get-Content -Raw -Encoding UTF8 $list | ConvertFrom-Json
$res = @()
$w = New-Object -ComObject Word.Application
try {
  $w.Visible = $false
  $w.DisplayAlerts = 0
  try { $w.Options.UpdateLinksAtOpen = $false } catch {}
  foreach ($it in $items) {
    try {
      $d = $w.Documents.Open([string]$it.src, $false, $true, $false)
      $d.ExportAsFixedFormat([string]$it.out, 17)
      $d.Close(0)
      $res += @{ id = $it.id; ok = $true }
    } catch {
      $res += @{ id = $it.id; ok = $false; error = $_.Exception.Message }
    }
  }
} finally {
  $w.Quit()
  [void][System.Runtime.InteropServices.Marshal]::ReleaseComObject($w)
}
ConvertTo-Json -InputObject @($res) -Compress | Out-File -Encoding UTF8 ($list + '.out')
`;
const WORD_CHECK = `
$w = New-Object -ComObject Word.Application
Write-Output $w.Version
$w.Quit()
`;

async function findSoffice() {
  const list = [process.env.SOFFICE,
    'C:\\Program Files\\LibreOffice\\program\\soffice.exe',
    'C:\\Program Files (x86)\\LibreOffice\\program\\soffice.exe',
    '/usr/bin/soffice', '/usr/local/bin/soffice', '/Applications/LibreOffice.app/Contents/MacOS/soffice'].filter(Boolean);
  for (const p of list) if (await fs.stat(p).then(() => true, () => false)) return p;
  return null;
}

// which program will make the PDFs: { engine: 'word'|'libreoffice'|null, detail }
let found = null;
export async function converter(workDir) {
  if (found) return found;
  if (process.platform === 'win32' && process.env.PDF_ENGINE !== 'libreoffice') {
    await fs.mkdir(workDir, { recursive: true });
    const ps = path.join(workDir, 'word-check.ps1');
    await fs.writeFile(ps, WORD_CHECK, 'utf8');
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps], 90000);
    const v = r.stdout.trim();
    if (!r.error && /^\d+/.test(v)) return (found = { engine: 'word', detail: `Microsoft Word ${v}` });
  }
  const soffice = await findSoffice();
  if (soffice) return (found = { engine: 'libreoffice', detail: 'LibreOffice', soffice });
  return (found = { engine: null, detail: 'Microsoft Word və LibreOffice tapılmadı' });
}

// items: [{ id, src, out }] -> Map id -> { ok, error }
export async function convertAll(items, workDir) {
  const c = await converter(workDir);
  const result = new Map();
  if (!c.engine || !items.length) return result;
  await fs.mkdir(workDir, { recursive: true });

  if (c.engine === 'word') {
    const ps = path.join(workDir, 'word-to-pdf.ps1');
    const list = path.join(workDir, `list-${Date.now()}.json`);
    await fs.writeFile(ps, WORD_PS1, 'utf8');
    await fs.writeFile(list, JSON.stringify(items.map(i => ({ id: i.id, src: path.resolve(i.src), out: path.resolve(i.out) }))), 'utf8');
    const r = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-File', ps, list], Math.max(180000, items.length * 120000));
    let out = [];
    try { out = JSON.parse((await fs.readFile(`${list}.out`, 'utf8')).replace(/^\uFEFF/, '')); } catch { /* Word stopped early */ }
    for (const o of [].concat(out)) if (o?.id) result.set(o.id, { ok: !!o.ok, error: o.error || '' });
    for (const i of items) if (!result.has(i.id)) result.set(i.id, { ok: false, error: r.error?.message || r.stderr.trim().slice(0, 300) || 'Word cavab vermədi' });
    await fs.rm(list, { force: true }); await fs.rm(`${list}.out`, { force: true });
    return result;
  }

  // LibreOffice: one file at a time, into its own folder
  for (const i of items) {
    const dir = path.join(workDir, `lo-${i.id}`);
    await fs.mkdir(dir, { recursive: true });
    const r = await run(c.soffice, ['--headless', '--norestore', '--nolockcheck', `-env:UserInstallation=file:///${path.join(os.tmpdir(), 'ga-lo-profile').replace(/\\/g, '/')}`, '--convert-to', 'pdf', '--outdir', dir, path.resolve(i.src)], 180000);
    const made = path.join(dir, `${path.basename(i.src).replace(/\.[^.]+$/, '')}.pdf`);
    if (await fs.stat(made).then(() => true, () => false)) {
      await fs.rename(made, i.out);
      result.set(i.id, { ok: true });
    } else {
      result.set(i.id, { ok: false, error: r.error?.message || r.stderr.trim().slice(0, 300) || 'PDF yaranmadı' });
    }
    await fs.rm(dir, { recursive: true, force: true });
  }
  return result;
}
