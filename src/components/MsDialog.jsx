// MsDialog.jsx — the Microsoft account that turns Word files into exact PDFs (once per file).
import { useEffect, useState } from 'react';
import { Loader2, Copy, Check, LogIn, Unplug, FileCheck2 } from 'lucide-react';
import { Modal, useUi } from './ui.jsx';
import { api } from '../lib/api.js';
import { msStatus, queueAll, waitingDocs, wordDocs, subscribe } from '../lib/pdfQueue.js';

export default function MsDialog({ catalog, onClose }) {
  const { toast, confirm } = useUi();
  const [st, setSt] = useState(null);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [jobs, setJobs] = useState([]);
  useEffect(() => { msStatus(true).then(setSt); }, []);
  useEffect(() => subscribe(setJobs), []);

  const all = wordDocs(catalog), left = waitingDocs(catalog);
  const running = jobs.some(j => j.state === 'waiting' || j.state === 'working');

  const signIn = async () => {
    setBusy(true);
    try { location.href = (await api.msLogin()).url; }
    catch (e) { toast(e.message, 'error'); setBusy(false); }
  };
  const unplug = async () => {
    if (!(await confirm({ title: 'Microsoft hesabı ayrılsın?', text: 'Hazır PDF-lər qalır. Yeni Word faylları PDF-ə çevrilməyəcək.', confirmLabel: 'Ayır', danger: true }))) return;
    await api.msDisconnect().catch(() => {});
    setSt(await msStatus(true));
  };
  const copy = () => { navigator.clipboard?.writeText(st.redirect).then(() => { setCopied(true); setTimeout(() => setCopied(false), 1500); }); };

  return (
    <Modal title="Microsoft hesabı" sub="Word fayllarını Word-dəki kimi dəqiq PDF-ə çevirir" onClose={onClose} wide>
      {!st ? (
        <div className="ms-row"><Loader2 size={16} className="spin" />Yoxlanılır</div>
      ) : !st.configured ? (
        <div className="ms-setup">
          <p>Bir dəfəlik qurulur (5 dəqiqə). Pulsuz Microsoft hesabı (outlook.com) da olar.</p>
          <ol>
            <li><a href="https://entra.microsoft.com/#view/Microsoft_AAD_RegisteredApps/ApplicationsListBlade" target="_blank" rel="noopener">entra.microsoft.com</a> → <b>App registrations</b> → <b>New registration</b>.
              Ad: <b>Gömrük Akademiyası</b>. Hesab növü: <b>Any Entra ID Tenant + Personal Microsoft accounts</b>.
              Redirect URI: <b>Web</b> və bu ünvan:
              <span className="ms-uri"><code>{st.redirect}</code><button className="btn small" onClick={copy}>{copied ? <Check size={14} /> : <Copy size={14} />}{copied ? 'Kopyalandı' : 'Kopyala'}</button></span>
            </li>
            <li><b>Certificates &amp; secrets</b> → <b>New client secret</b> → <b>Value</b> sütunundakı yazını kopyalayın.</li>
            <li>Vercel → layihə → <b>Settings</b> → <b>Environment Variables</b>:
              <br /><code>MS_CLIENT_ID</code> = Overview-dakı <b>Application (client) ID</b>
              <br /><code>MS_CLIENT_SECRET</code> = 2-ci addımdakı yazı
              <br />Sonra <b>Deployments</b> → <b>Redeploy</b>.</li>
            <li>Bu pəncərəni yenidən açıb <b>Microsoft hesabı ilə daxil ol</b> düyməsini basın.</li>
          </ol>
        </div>
      ) : !st.account ? (
        <div className="ms-setup">
          <p>Microsoft hesabınızla bir dəfə daxil olun. Word faylları bu hesabın OneDrive-ında PDF-ə çevrilir, sonra oradan silinir.</p>
          <button className="btn primary" onClick={signIn} disabled={busy}>{busy ? <Loader2 size={15} className="spin" /> : <LogIn size={15} />}Microsoft hesabı ilə daxil ol</button>
        </div>
      ) : (
        <div className="ms-setup">
          <div className="ms-row"><FileCheck2 size={17} className="good" /><span>Qoşulub: <b>{st.account.name || st.account.email}</b>{st.account.name && st.account.email ? ` (${st.account.email})` : ''}</span></div>
          <p>Word faylları: {all.length} · PDF-i hazır: {all.length - left.length}{left.length ? ` · Gözləyən: ${left.length}` : ''}</p>
          <div className="ms-actions">
            {left.length > 0 && (
              <button className="btn primary" disabled={running} onClick={() => { queueAll(left); toast(`${left.length} fayl hazırlanır`); }}>
                {running ? <Loader2 size={15} className="spin" /> : <FileCheck2 size={15} />}{running ? 'Hazırlanır' : `Qalan ${left.length} faylı indi hazırla`}
              </button>
            )}
            <button className="btn" onClick={unplug}><Unplug size={15} />Hesabı ayır</button>
          </div>
        </div>
      )}
    </Modal>
  );
}
