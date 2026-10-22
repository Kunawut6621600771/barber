import { useState, useEffect } from 'react';
import { api } from '../api/client.js';
import { useAuth, ROLE_LABEL } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Field, PasswordInput, Switch, Avatar, Alert } from '../components/ui.jsx';
import LineConnectCard from '../components/LineConnectCard.jsx';

export default function Profile() {
  const { user, setUser, refreshUser } = useAuth();
  const toast = useToast();

  const [form, setForm] = useState({ full_name: '', phone: '', birth_date: '' });
  const [notify, setNotify] = useState({ notify_near_turn: true, notify_my_turn: true, notify_cancel: true });
  const [pw, setPw] = useState({ current_password: '', new_password: '', confirm: '' });
  const [errors, setErrors] = useState({});
  const [pwErrors, setPwErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [pwBusy, setPwBusy] = useState(false);
  const [qr, setQr] = useState(null);

  useEffect(() => {
    refreshUser().then((u) => {
      setForm({ full_name: u.full_name, phone: u.phone || '', birth_date: u.birth_date?.slice(0, 10) || '' });
      setNotify({
        notify_near_turn: u.notify_near_turn ?? true,
        notify_my_turn: u.notify_my_turn ?? true,
        notify_cancel: u.notify_cancel ?? true,
      });
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const saveProfile = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const payload = { full_name: form.full_name, ...notify };
      if (form.phone) payload.phone = form.phone;
      if (form.birth_date) payload.birth_date = form.birth_date;
      const d = await api.put('/users/me', payload);
      setUser((u) => ({ ...u, ...d.user }));
      toast.ok('บันทึกข้อมูลส่วนตัวเรียบร้อยแล้ว');
    } catch (err) {
      toast.error(err.message);
      setErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  };

  const changePassword = async (e) => {
    e.preventDefault();
    setPwErrors({});
    if (pw.new_password !== pw.confirm) {
      setPwErrors({ confirm: 'รหัสผ่านทั้งสองช่องไม่ตรงกัน' });
      return;
    }
    setPwBusy(true);
    try {
      const d = await api.post('/auth/change-password', {
        current_password: pw.current_password,
        new_password: pw.new_password,
      });
      toast.ok(d.message);
      setPw({ current_password: '', new_password: '', confirm: '' });
    } catch (err) {
      toast.error(err.message);
      setPwErrors(err.details || {});
    } finally {
      setPwBusy(false);
    }
  };

  const loadShopQr = async () => {
    try {
      setQr(await api.get('/queue/shop-qr'));
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="page">
      <div className="page-head">
        <h1>ข้อมูลส่วนตัว</h1>
        <div className="sub">จัดการข้อมูลบัญชี การแจ้งเตือน และรหัสผ่านของคุณ</div>
      </div>

      <div className="grid grid-2">
        <Card title="ข้อมูลบัญชี">
          <div className="row gap-3" style={{ marginBottom: 18 }}>
            <Avatar name={user.full_name} size="lg" />
            <div>
              <div className="bold">{user.full_name}</div>
              <div className="small muted">{user.email}</div>
              <span className="badge mt-1">{ROLE_LABEL[user.role]}</span>
            </div>
          </div>

          <form onSubmit={saveProfile}>
            <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
              <input className="input" value={form.full_name}
                onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
            </Field>
            <Field label="อีเมล" hint="ไม่สามารถเปลี่ยนอีเมลได้ด้วยตนเอง กรุณาติดต่อผู้ดูแลระบบ">
              <input className="input" value={user.email} disabled />
            </Field>
            <Field label="เบอร์โทรศัพท์" error={errors.phone}>
              <input className="input" value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="08x-xxx-xxxx" />
            </Field>
            <Field label="วันเกิด" error={errors.birth_date}>
              <input className="input" type="date" value={form.birth_date}
                onChange={(e) => setForm((f) => ({ ...f, birth_date: e.target.value }))} />
            </Field>

            <h3 className="mt-4">การแจ้งเตือน</h3>
            <p className="small muted" style={{ marginBottom: 12 }}>เลือกเหตุการณ์ที่ต้องการให้ระบบแจ้งเตือน</p>

            {[
              ['notify_near_turn', 'ใกล้ถึงคิว', 'แจ้งเตือนเมื่อเหลืออีกไม่กี่คิวก่อนถึงคุณ'],
              ['notify_my_turn', 'ถึงคิวแล้ว', 'แจ้งเตือนทันทีที่พนักงานเรียกคิวของคุณ'],
              ['notify_cancel', 'คิวถูกยกเลิกหรือข้าม', 'แจ้งเตือนเมื่อคิวของคุณถูกยกเลิกหรือถูกข้าม'],
            ].map(([key, title, hint]) => (
              <div key={key} className="row-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--ink-100)' }}>
                <div>
                  <div className="bold small">{title}</div>
                  <div className="tiny muted">{hint}</div>
                </div>
                <Switch checked={notify[key]} onChange={(v) => setNotify((n) => ({ ...n, [key]: v }))} />
              </div>
            ))}

            <button className="btn primary mt-4" type="submit" disabled={busy}>
              {busy && <span className="spinner" />}บันทึกการเปลี่ยนแปลง
            </button>
          </form>
        </Card>

        <div className="col gap-4">
          <Card title="เปลี่ยนรหัสผ่าน" subtitle="หลังเปลี่ยนรหัสผ่าน อุปกรณ์อื่นจะถูกออกจากระบบทั้งหมด">
            <form onSubmit={changePassword}>
              <Field label="รหัสผ่านปัจจุบัน" error={pwErrors.current_password}>
                <PasswordInput value={pw.current_password} autoComplete="current-password"
                  onChange={(e) => setPw((p) => ({ ...p, current_password: e.target.value }))}
                  error={pwErrors.current_password} />
              </Field>
              <Field label="รหัสผ่านใหม่" error={pwErrors.new_password} hint="อย่างน้อย 6 ตัวอักษร">
                <PasswordInput value={pw.new_password} autoComplete="new-password"
                  onChange={(e) => setPw((p) => ({ ...p, new_password: e.target.value }))}
                  error={pwErrors.new_password} />
              </Field>
              <Field label="ยืนยันรหัสผ่านใหม่" error={pwErrors.confirm}>
                <PasswordInput value={pw.confirm} autoComplete="new-password"
                  onChange={(e) => setPw((p) => ({ ...p, confirm: e.target.value }))}
                  error={pwErrors.confirm} />
              </Field>
              <button className="btn dark" type="submit"
                disabled={pwBusy || !pw.current_password || !pw.new_password}>
                {pwBusy && <span className="spinner" />}เปลี่ยนรหัสผ่าน
              </button>
            </form>
          </Card>

          <LineConnectCard />

          {['admin', 'staff'].includes(user.role) && (
            <Card title="QR Code หน้าร้าน" subtitle="พิมพ์ติดไว้หน้าร้านให้ลูกค้าสแกนรับบัตรคิว">
              {qr ? (
                <div className="center">
                  <img src={qr.qr_code} alt="QR หน้าร้าน" width={220} height={220} />
                  <p className="tiny muted mt-2" style={{ wordBreak: 'break-all' }}>{qr.url}</p>
                  <button className="btn mt-2" onClick={() => window.print()}>พิมพ์ QR</button>
                </div>
              ) : (
                <>
                  <Alert kind="info">ลูกค้าสแกน QR นี้เพื่อเปิดหน้ารับบัตรคิวได้ทันที</Alert>
                  <button className="btn dark block" onClick={loadShopQr}>สร้าง QR หน้าร้าน</button>
                </>
              )}
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
