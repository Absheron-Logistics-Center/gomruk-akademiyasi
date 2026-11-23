import { useEffect, useState } from 'react';
import { LogIn, Loader2 } from 'lucide-react';
import { api, login } from '../lib/api.js';
import BgLogin from '../assets/login.png';
import Logo from '../assets/header-logo.svg';

export default function Login({ onLogin }) {
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [needPassword, setNeedPassword] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    api.config().then(c => {
      setNeedPassword(!!c?.passwordRequired);
      if (c && !c.storage) setError(c.problem || 'Yaddaş qoşulmayıb.');
    }).catch(() => {});
  }, []);

  async function submit(e) {
    e.preventDefault();
    if (username.trim().length < 2) { setError('Adınızı yazın.'); return; }
    if (needPassword && !password) { setError('Şifrəni yazın.'); return; }
    setLoading(true); setError('');
    try { onLogin(await login(username.trim(), password)); }
    catch (err) { setError(err.message); }
    finally { setLoading(false); }
  }

  return (
    <div className="login-wrap">
      <img src={BgLogin} alt="" />
      <form className="login-card" onSubmit={submit}>
        <img src={Logo} alt="Abşeron Logistika Mərkəzi" />
        <h1>GÖMRÜK AKADEMİYASI</h1>
        <div className="sub">Adınızı yazıb daxil olun. Test nəticələriniz bu adla saxlanılır.</div>
        <div className="field">
          <label htmlFor="ga-user">Adınız</label>
          <input id="ga-user" type="text" autoComplete="name" maxLength={60} value={username} onChange={e => setUsername(e.target.value)} />
        </div>
        {needPassword && (
          <div className="field">
            <label htmlFor="ga-pass">Şifrə</label>
            <input id="ga-pass" type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} />
          </div>
        )}
        {error && <div className="form-error">{error}</div>}
        <button className="login-btn" type="submit" disabled={loading}>
          {loading ? <Loader2 size={16} className="spin" /> : <LogIn size={16} />}
          {loading ? 'Yoxlanılır' : 'Daxil ol'}
        </button>
      </form>
    </div>
  );
}
