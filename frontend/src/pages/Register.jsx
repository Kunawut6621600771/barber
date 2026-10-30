import { useState } from 'react';
import { Link, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { safeTarget } from '../api/liff.js';
import { Field, PasswordInput, Alert } from '../components/ui.jsx';
import AuthVisual from '../components/AuthVisual.jsx';

/** หน้าที่ส่งมาให้สมัคร (เช่น สแกน QR หน้าร้าน) — รับเฉพาะ path ภายในแอป */
const safeFrom = (from) => (typeof from === 'string' && /^\/liff(\?|$)/.test(from) ? from : safeTarget(from));

export default function Register() {
  const { register } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const from = safeFrom(location.state?.from);

  const [form, setForm] = useState({
    full_name: location.state?.lineName || '', email: '', phone: '', password: '', confirm: '',
  });
  const [accept, setAccept] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [busy, setBusy] = useState(false);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});

    if (form.password !== form.confirm) {
      setFieldErrors({ confirm: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
      return;
    }
    if (!accept) {
      setError('กรุณายอมรับเงื่อนไขการใช้งานก่อนสมัครสมาชิก');
      return;
    }

    setBusy(true);
    try {
      await register({
        full_name: form.full_name,
        email: form.email,
        phone: form.phone,
        password: form.password,
      });
      navigate(from || '/app/my-queue', { replace: true });
    } catch (err) {
      setError(err.message);
      setFieldErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <AuthVisual />

      <div className="auth-form-side">
        <div className="auth-card">
          <h1>สร้างบัญชีใหม่</h1>
          <p className="lead">สมัครสมาชิกเพื่อรับบัตรคิวออนไลน์และรับการแจ้งเตือน</p>

          {error && <Alert kind="error">{error}</Alert>}

          <form onSubmit={submit} noValidate>
            <Field label="ชื่อ-นามสกุล" error={fieldErrors.full_name}>
              <input className={`input ${fieldErrors.full_name ? 'error' : ''}`}
                value={form.full_name} onChange={set('full_name')}
                placeholder="เช่น อริญชัย สุวรรณเกิด" autoComplete="name" required />
            </Field>

            <Field label="อีเมล" error={fieldErrors.email}>
              <input className={`input ${fieldErrors.email ? 'error' : ''}`} type="email"
                value={form.email} onChange={set('email')}
                placeholder="you@example.com" autoComplete="email" required />
            </Field>

            <Field label="เบอร์โทรศัพท์" error={fieldErrors.phone}
              hint="ใช้สำหรับติดต่อกลับและยืนยันคิว">
              <input className={`input ${fieldErrors.phone ? 'error' : ''}`}
                value={form.phone} onChange={set('phone')}
                placeholder="08x-xxx-xxxx" autoComplete="tel" required />
            </Field>

            <Field label="รหัสผ่าน" error={fieldErrors.password} hint="อย่างน้อย 6 ตัวอักษร">
              <PasswordInput value={form.password} onChange={set('password')}
                placeholder="••••••••" autoComplete="new-password" error={fieldErrors.password} />
            </Field>

            <Field label="ยืนยันรหัสผ่าน" error={fieldErrors.confirm}>
              <PasswordInput value={form.confirm} onChange={set('confirm')}
                placeholder="••••••••" autoComplete="new-password" error={fieldErrors.confirm} />
            </Field>

            <label className="checkbox" style={{ marginBottom: 16 }}>
              <input type="checkbox" checked={accept} onChange={(e) => setAccept(e.target.checked)} />
              <span className="small">
                ฉันยอมรับ <a href="#terms" style={{ color: 'var(--brand)' }}>เงื่อนไขการใช้งาน</a> และ{' '}
                <a href="#privacy" style={{ color: 'var(--brand)' }}>นโยบายความเป็นส่วนตัว</a>
              </span>
            </label>

            <button className="btn primary block lg" type="submit" disabled={busy}>
              {busy && <span className="spinner" />}สมัครสมาชิก
            </button>
          </form>

          <p className="auth-alt">
            มีบัญชีอยู่แล้ว? <Link to="/login" state={from ? { from } : undefined}>เข้าสู่ระบบ</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
