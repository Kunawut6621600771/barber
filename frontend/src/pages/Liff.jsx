import { useEffect, useState, useRef } from 'react';
import { useNavigate, Link } from 'react-router-dom';
import { api, ApiError } from '../api/client.js';
import { initLiff, safeTarget } from '../api/liff.js';
import { useAuth, isStaffRole } from '../context/AuthContext.jsx';
import { Alert } from '../components/ui.jsx';

/**
 * หน้าเข้าแอปจาก LINE (LIFF Endpoint URL = https://<โดเมน>/liff)
 *
 *  https://liff.line.me/<LIFF_ID>?to=/app/take-queue
 *   1. init LIFF + ขอ ID token จาก LINE
 *   2. เคยผูกบัญชีแล้ว -> เข้าสู่ระบบอัตโนมัติ แล้วไปหน้าที่ต้องการ
 *   3. ยังไม่เคยผูก -> ให้เลือก "เริ่มใช้งานด้วย LINE" หรือ "เข้าสู่ระบบบัญชีเดิม"
 */
export default function Liff() {
  const { user, loading, loginWithSession, refreshUser } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState('loading'); // loading | choose | error
  const [error, setError] = useState('');
  const [profile, setProfile] = useState(null);
  const [busy, setBusy] = useState(false);
  const idTokenRef = useRef(null);
  const targetRef = useRef('/app/my-queue');
  const started = useRef(false);

  const home = (u) => (isStaffRole(u?.role) ? '/app/dashboard' : '/app/my-queue');

  useEffect(() => {
    if (loading || started.current) return;
    started.current = true;

    (async () => {
      try {
        const liff = await initLiff();

        // LIFF จะพากลับมาที่ URL เดิมพร้อม query เอง ระหว่างนี้ยังไม่ต้องทำอะไร
        const qs = new URLSearchParams(window.location.search);
        if (qs.has('liff.state')) return;
        targetRef.current = safeTarget(qs.get('to')) || null;

        if (!liff.isLoggedIn()) {
          liff.login({ redirectUri: window.location.href });
          return;
        }

        const idToken = liff.getIDToken();
        if (!idToken) throw new Error('ไม่ได้รับข้อมูลยืนยันตัวตนจาก LINE กรุณาเปิดสิทธิ์ openid ใน LIFF app');
        idTokenRef.current = idToken;

        // ล็อกอินอยู่แล้ว (เช่น เพิ่งล็อกอินด้วยอีเมลเพื่อเชื่อมบัญชี) -> ผูก LINE แล้วไปต่อ
        if (user) {
          if (!user.line_linked) {
            await api.post('/line/link', { id_token: idToken });
            await refreshUser().catch(() => {});
          }
          navigate(targetRef.current || home(user), { replace: true });
          return;
        }

        try {
          const d = await api.post('/auth/line', { id_token: idToken });
          const u = loginWithSession(d);
          navigate(targetRef.current || home(u), { replace: true });
        } catch (err) {
          if (err instanceof ApiError && err.details?.code === 'not_linked') {
            setProfile({ name: err.details.name, picture: err.details.picture });
            setStep('choose');
            return;
          }
          throw err;
        }
      } catch (err) {
        setError(err.message || 'เปิดแอปผ่าน LINE ไม่สำเร็จ');
        setStep('error');
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading]);

  const startWithLine = async () => {
    setBusy(true);
    setError('');
    try {
      const d = await api.post('/auth/line', { id_token: idTokenRef.current, create: true });
      const u = loginWithSession(d);
      navigate(targetRef.current || '/app/take-queue', { replace: true });
      return u;
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
    return null;
  };

  const back = `/liff${targetRef.current ? `?to=${encodeURIComponent(targetRef.current)}` : ''}`;

  return (
    <div className="liff-wrap">
      <div className="liff-card">
        <div className="liff-brand">
          <div className="liff-logo">✂</div>
          <div>
            <div className="bold">Trim &amp; Co.</div>
            <div className="tiny muted">ระบบเรียกคิวร้านตัดผม</div>
          </div>
        </div>

        {step === 'loading' && (
          <div className="col gap-2 center" style={{ padding: '28px 0' }}>
            <span className="spinner" style={{ width: 26, height: 26 }} />
            <span className="small muted">กำลังเชื่อมต่อกับ LINE...</span>
          </div>
        )}

        {step === 'error' && (
          <>
            <Alert kind="error">{error}</Alert>
            <div className="col gap-2 mt-3">
              <button className="btn dark block" onClick={() => window.location.reload()}>ลองอีกครั้ง</button>
              <Link className="btn block" to="/login">เข้าสู่ระบบด้วยอีเมล</Link>
            </div>
          </>
        )}

        {step === 'choose' && (
          <>
            <div className="center" style={{ padding: '8px 0 16px' }}>
              {profile?.picture
                ? <img src={profile.picture} alt="" className="liff-avatar" />
                : <div className="liff-avatar placeholder">👤</div>}
              <h2 style={{ margin: '10px 0 4px' }}>สวัสดี{profile?.name ? ` คุณ${profile.name}` : ''}</h2>
              <p className="small muted" style={{ margin: 0 }}>
                เริ่มใช้งานครั้งแรก เลือกวิธีเข้าใช้งานด้านล่าง ระบบจะแจ้งเตือนคิวผ่าน LINE ให้อัตโนมัติ
              </p>
            </div>

            {error && <Alert kind="error">{error}</Alert>}

            <button className="btn line block lg" onClick={startWithLine} disabled={busy}>
              {busy && <span className="spinner" />}เริ่มใช้งานด้วยบัญชี LINE
            </button>
            <div className="tiny muted center mt-1">สร้างบัญชีลูกค้าใหม่จากโปรไฟล์ LINE ไม่ต้องตั้งรหัสผ่าน</div>

            <div className="liff-or"><span>หรือ</span></div>

            <button className="btn block" onClick={() => navigate('/login', { state: { from: back } })}>
              มีบัญชีอยู่แล้ว — เข้าสู่ระบบเพื่อเชื่อม LINE
            </button>
          </>
        )}
      </div>
    </div>
  );
}
