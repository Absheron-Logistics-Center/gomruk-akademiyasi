// ui.jsx — toasts, confirm / prompt dialogs and the modal shell (same look as Map-Panel).
import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { X, AlertTriangle } from 'lucide-react';

const UiCtx = createContext(null);
export const useUi = () => useContext(UiCtx);

export function UiProvider({ children }) {
  const [toasts, setToasts] = useState([]);
  const [dialog, setDialog] = useState(null);
  const seq = useRef(0);

  const toast = useCallback((text, kind = 'info') => {
    const id = ++seq.current;
    setToasts(t => [...t.slice(-2), { id, text, kind }]);
    setTimeout(() => setToasts(t => t.filter(x => x.id !== id)), kind === 'error' ? 6500 : 4200);
  }, []);

  const confirm = useCallback((opts) => new Promise(resolve => setDialog({ ...opts, kind: 'confirm', resolve })), []);
  const prompt = useCallback((opts) => new Promise(resolve => setDialog({ ...opts, kind: 'prompt', resolve })), []);

  const close = (value) => { dialog?.resolve(value); setDialog(null); };

  return (
    <UiCtx.Provider value={{ toast, confirm, prompt }}>
      {children}
      {createPortal(
        <div className="toast-stack" role="status" aria-live="polite">
          {toasts.map(t => <div key={t.id} className={`toast ${t.kind}`}>{t.text}</div>)}
        </div>,
        document.body
      )}
      {dialog?.kind === 'confirm' && <ConfirmDialog {...dialog} onClose={close} />}
      {dialog?.kind === 'prompt' && <PromptDialog {...dialog} onClose={close} />}
    </UiCtx.Provider>
  );
}

export function Modal({ title, sub, onClose, children, footer, wide, busy }) {
  useEffect(() => {
    const k = (e) => { if (e.key === 'Escape' && !busy) onClose?.(); };
    window.addEventListener('keydown', k);
    return () => window.removeEventListener('keydown', k);
  }, [onClose, busy]);
  return createPortal(
    <div className="ga-backdrop" onMouseDown={e => { if (e.target === e.currentTarget && !busy) onClose?.(); }}>
      <div className={`ga-modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="ga-modal-head">
          <div>
            <h2>{title}</h2>
            {sub && <p className="ga-modal-sub">{sub}</p>}
          </div>
          {onClose && (
            <button className="modal-close" onClick={onClose} disabled={busy} aria-label="Bağla"><X size={17} /></button>
          )}
        </div>
        <div className="ga-modal-body">{children}</div>
        {footer && <div className="ga-modal-foot">{footer}</div>}
      </div>
    </div>,
    document.body
  );
}

function ConfirmDialog({ title, text, confirmLabel = 'Təsdiqlə', cancelLabel = 'Geri qayıt', danger, onClose }) {
  const ok = useRef(null);
  useEffect(() => { ok.current?.focus(); }, []);
  return (
    <Modal
      title={title}
      onClose={() => onClose(false)}
      footer={<>
        <button className="btn" onClick={() => onClose(false)}>{cancelLabel}</button>
        <button ref={ok} className={`btn ${danger ? 'danger-solid' : 'primary'}`} onClick={() => onClose(true)}>{confirmLabel}</button>
      </>}
    >
      <div className={`confirm-text ${danger ? 'danger' : ''}`}>
        {danger && <AlertTriangle size={18} />}
        <p>{text}</p>
      </div>
    </Modal>
  );
}

function PromptDialog({ title, label, value = '', placeholder, confirmLabel = 'Yadda saxla', type = 'text', min, max, onClose }) {
  const [v, setV] = useState(String(value ?? ''));
  const ref = useRef(null);
  useEffect(() => { ref.current?.focus(); ref.current?.select?.(); }, []);
  const submit = (e) => { e.preventDefault(); if (type === 'text' && !v.trim()) return; onClose(type === 'number' ? Number(v) || 0 : v.trim()); };
  return (
    <Modal
      title={title}
      onClose={() => onClose(null)}
      footer={<>
        <button className="btn" onClick={() => onClose(null)}>Ləğv et</button>
        <button className="btn primary" onClick={submit}>{confirmLabel}</button>
      </>}
    >
      <form onSubmit={submit} className="field-block">
        {label && <label>{label}</label>}
        <input ref={ref} type={type} min={min} max={max} value={v} placeholder={placeholder} maxLength={250} onChange={e => setV(e.target.value)} />
      </form>
    </Modal>
  );
}

export function Progress({ value, label }) {
  const pct = Math.round(Math.max(0, Math.min(1, value || 0)) * 100);
  return (
    <div className="ga-progress" aria-label={label} aria-valuenow={pct} role="progressbar">
      <div className="ga-progress-fill" style={{ width: `${pct}%` }} />
    </div>
  );
}
