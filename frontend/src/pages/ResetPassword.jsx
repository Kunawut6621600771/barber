import { useState } from 'react';
import { Link, useSearchParams, useNavigate } from 'react-router-dom';
import { api } from '../api/client.js';
import { Field, PasswordInput, Alert } from '../components/ui.jsx';
import AuthVisual from '../components/AuthVisual.jsx';

/** ใช้ทั้ง "ตั้งรหัสผ่านใหม่" (Forgot Password) และ "ตั้งรหัสผ่านครั้งแรก" (Create Password) */
export default function ResetPassword() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const token = params.get('token') || '';

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState({});
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    setFieldErrors({});
    if (password !== confirm) {
      setFieldErrors({ confirm: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
      return;
    }
    setBusy(true);
    try {
      await api.post('/auth/reset-password', { token, new_password: password });
      setDone(true);
      setTimeout(() => navigate('/login', { replace: true }), 2200);
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
          <h1>ตั้งรหัสผ่านใหม่</h1>
          <p className="lead">กำหนดรหัสผ่านใหม่สำหรับบัญชีของคุณ</p>

          {!token && <Alert kind="error">ลิงก์ไม่ถูกต้อง กรุณาขอลิงก์ใหม่จากหน้า "ลืมรหัสผ่าน"</Alert>}
          {error && <Alert kind="error">{error}</Alert>}
          {done && <Alert kind="ok">ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กำลังพากลับไปหน้าเข้าสู่ระบบ...</Alert>}

          {!done && token && (
            <form onSubmit={submit} noValidate>
              <Field label="รหัสผ่านใหม่" error={fieldErrors.password} hint="อย่างน้อย 6 ตัวอักษร">
                <PasswordInput value={password} onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••" autoComplete="new-password" error={fieldErrors.password} />
              </Field>
              <Field label="ยืนยันรหัสผ่านใหม่" error={fieldErrors.confirm}>
                <PasswordInput value={confirm} onChange={(e) => setConfirm(e.target.value)}
                  placeholder="••••••••" autoComplete="new-password" error={fieldErrors.confirm} />
              </Field>
              <button className="btn dark block lg" type="submit" disabled={busy}>
                {busy && <span className="spinner" />}บันทึกรหัสผ่านใหม่
              </button>
            </form>
          )}

          <p className="auth-alt"><Link to="/login">← กลับไปหน้าเข้าสู่ระบบ</Link></p>
        </div>
      </div>
    </div>
  );
}
