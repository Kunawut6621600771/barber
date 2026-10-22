import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { Field, Alert } from '../components/ui.jsx';
import AuthVisual from '../components/AuthVisual.jsx';

export default function ForgotPassword() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const d = await api.post('/auth/forgot-password', { email });
      setSent(d);
    } catch (err) {
      setError(err.details?.email || err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="auth-wrap">
      <AuthVisual />
      <div className="auth-form-side">
        <div className="auth-card">
          <h1>ลืมรหัสผ่าน</h1>
          <p className="lead">กรอกอีเมลที่ใช้สมัคร ระบบจะส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ให้</p>

          {error && <Alert kind="error">{error}</Alert>}

          {sent ? (
            <>
              <Alert kind="ok">{sent.message}</Alert>
              {sent.reset_link && (
                <div className="card mt-3">
                  <div className="card-body">
                    <div className="small bold">โหมดพัฒนา — ลิงก์สำหรับทดสอบ</div>
                    <p className="tiny muted mt-1">
                      ระบบยังไม่ได้เชื่อมต่อบริการอีเมลจริง จึงแสดงลิงก์ไว้ที่นี่
                    </p>
                    <Link to={sent.reset_link.replace(window.location.origin, '')}
                      className="btn dark block mt-3">ไปตั้งรหัสผ่านใหม่</Link>
                  </div>
                </div>
              )}
            </>
          ) : (
            <form onSubmit={submit} noValidate>
              <Field label="อีเมล">
                <input className="input" type="email" value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@example.com" autoComplete="email" required />
              </Field>
              <button className="btn dark block lg" type="submit" disabled={busy}>
                {busy && <span className="spinner" />}ส่งลิงก์รีเซ็ตรหัสผ่าน
              </button>
            </form>
          )}

          <p className="auth-alt"><Link to="/login">← กลับไปหน้าเข้าสู่ระบบ</Link></p>
        </div>
      </div>
    </div>
  );
}
