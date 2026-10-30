import { useState, useEffect } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth, isStaffRole } from '../context/AuthContext.jsx';
import { getLineConfig, looksLikeLineApp, safeTarget } from '../api/liff.js';
import { Field, PasswordInput, Alert } from '../components/ui.jsx';
import AuthVisual from '../components/AuthVisual.jsx';

export default function Login() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [remember, setRemember] = useState(true);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  // เปิดจากแอป LINE (เช่น สแกน QR หน้าร้านด้วยกล้อง LINE) -> เข้าด้วยบัญชี LINE แทนการกรอกอีเมล
  // ยกเว้นตอนที่หน้า LIFF ส่งมาให้ล็อกอินบัญชีเดิมเพื่อเชื่อม LINE (from ขึ้นต้นด้วย /liff)
  useEffect(() => {
    const from = location.state?.from;
    if (!looksLikeLineApp() || from?.startsWith('/liff') || location.state?.emailOnly) return;
    getLineConfig().then((cfg) => {
      if (!cfg.liff_enabled) return;
      const to = safeTarget(from);
      navigate(`/liff${to ? `?to=${encodeURIComponent(to)}` : ''}`, { replace: true });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    setBusy(true);
    try {
      const user = await login(email, password);
      const to = location.state?.from
        || (isStaffRole(user.role) ? '/app/dashboard' : '/app/my-queue');
      navigate(to, { replace: true });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  };

  const fillDemo = (demoEmail) => { setEmail(demoEmail); setPassword('123456'); };

  return (
    <div className="auth-wrap">
      <AuthVisual showQr />

      <div className="auth-form-side">
        <div className="auth-card">
          <h1>ยินดีต้อนรับ</h1>
          <p className="lead">เข้าสู่ระบบเพื่อจัดการคิวและติดตามสถานะแบบเรียลไทม์</p>

          {error && <Alert kind="error">{error}</Alert>}

          <form onSubmit={submit} noValidate>
            <Field label="อีเมล" error={fieldErrors.email}>
              <input
                className={`input ${fieldErrors.email ? 'error' : ''}`}
                type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com" autoComplete="email" required
              />
            </Field>

            <Field label="รหัสผ่าน" error={fieldErrors.password}>
              <PasswordInput
                value={password} onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••" autoComplete="current-password" error={fieldErrors.password}
              />
            </Field>

            <div className="row-between" style={{ marginBottom: 18 }}>
              <label className="checkbox">
                <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
                <span>จดจำฉันไว้</span>
              </label>
              <Link to="/forgot-password" className="small" style={{ color: 'var(--brand)', fontWeight: 600 }}>
                ลืมรหัสผ่าน?
              </Link>
            </div>

            <button className="btn dark block lg" type="submit" disabled={busy}>
              {busy && <span className="spinner" />}เข้าสู่ระบบ
            </button>
          </form>

          <div className="divider">บัญชีทดสอบ</div>
          <div className="row wrap gap-2">
            <button className="btn sm" onClick={() => fillDemo('admin@trimco.local')}>ผู้ดูแลระบบ</button>
            <button className="btn sm" onClick={() => fillDemo('staff@trimco.local')}>พนักงาน</button>
            <button className="btn sm" onClick={() => fillDemo('barber1@trimco.local')}>ช่างตัดผม</button>
            <button className="btn sm" onClick={() => fillDemo('arin@example.com')}>ลูกค้า</button>
          </div>
          <p className="tiny muted center mt-2">รหัสผ่านทุกบัญชีทดสอบคือ 123456</p>

          <p className="auth-alt">
            ยังไม่มีบัญชี? <Link to="/register">สมัครสมาชิก</Link>
          </p>
          <p className="auth-alt" style={{ marginTop: 6 }}>
            <Link to="/board" className="muted">ดูจอแสดงคิวหน้าร้าน →</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
