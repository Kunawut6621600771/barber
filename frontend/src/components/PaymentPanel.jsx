import { useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { Card, Alert, baht, dateTimeOf } from './ui.jsx';
import LineQrCard from './LineQrCard.jsx';

/** ย่อรูปสลิปก่อนส่ง (ด้านยาวไม่เกิน 1600px) ให้ส่งเร็วและไม่เกินขนาดที่ API รับได้ */
async function fileToDataUrl(file) {
  const raw = await new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result);
    r.onerror = () => reject(new Error('อ่านไฟล์รูปไม่สำเร็จ'));
    r.readAsDataURL(file);
  });
  const img = await new Promise((resolve, reject) => {
    const i = new Image();
    i.onload = () => resolve(i);
    i.onerror = () => reject(new Error('ไฟล์นี้ไม่ใช่รูปภาพ'));
    i.src = raw;
  });
  const max = 1600;
  const scale = Math.min(1, max / Math.max(img.width, img.height));
  if (scale === 1 && file.size < 2_500_000) return raw;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(img.width * scale);
  canvas.height = Math.round(img.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.9);
}

/** รูปสลิปปลอมสำหรับโหมดทดสอบ (SLIP_PROVIDER=mock) */
function mockSlip(payment) {
  const c = document.createElement('canvas');
  c.width = 480; c.height = 640;
  const ctx = c.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, c.width, c.height);
  ctx.fillStyle = '#111'; ctx.font = '28px sans-serif';
  ctx.fillText('TEST SLIP', 40, 80);
  ctx.fillText(`${payment.ref_code}`, 40, 130);
  ctx.fillText(`${payment.amount} THB`, 40, 180);
  ctx.fillText(new Date().toISOString(), 40, 230);
  ctx.fillText(Math.random().toString(36).slice(2), 40, 280);
  return c.toDataURL('image/png');
}

function useCountdown(until) {
  const [left, setLeft] = useState(() => Math.max(0, new Date(until) - Date.now()));
  useEffect(() => {
    const t = setInterval(() => setLeft(Math.max(0, new Date(until) - Date.now())), 1000);
    return () => clearInterval(t);
  }, [until]);
  const m = Math.floor(left / 60000);
  const s = Math.floor((left % 60000) / 1000);
  return { left, text: `${m}:${String(s).padStart(2, '0')}` };
}

/**
 * ขั้นตอนชำระเงิน: แสดง QR PromptPay -> ลูกค้าอัปโหลดสลิป -> ตรวจอัตโนมัติ
 * onPaid(result)  result = { ticket, qr_code, track_url } หรือ { ticket: null } กรณีพนักงานยืนยันให้
 */
export default function PaymentPanel({ payment, testMode, onPaid, onCancel }) {
  const [slipPreview, setSlipPreview] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const fileRef = useRef(null);
  const busyRef = useRef(false);   // กำลังส่งสลิปอยู่ -> ไม่ต้องเช็กสถานะซ้ำ
  const doneRef = useRef(false);   // เรียก onPaid ไปแล้ว
  const finish = (d) => {
    if (doneRef.current) return;
    doneRef.current = true;
    onPaid(d);
  };
  const { left, text } = useCountdown(payment.expires_at);
  const expired = left <= 0;

  // พนักงานอาจกดยืนยันให้จากหน้าร้าน -> คอยเช็กสถานะ
  const check = async () => {
    if (busyRef.current || doneRef.current) return;
    try {
      const d = await api.get(`/payments/${payment.id}`);
      if (busyRef.current) return;
      if (d.payment.status === 'paid') finish({ ticket: null, payment: d.payment });
    } catch { /* เงียบไว้ */ }
  };
  useRealtime({ 'payment:update': (d) => { if (d?.id === payment.id) check(); } });
  useEffect(() => {
    const t = setInterval(check, 8000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [payment.id]);

  const send = async (image) => {
    setBusy(true);
    busyRef.current = true;
    setError('');
    try {
      const d = await api.post(`/payments/${payment.id}/slip`, { image });
      finish(d);
    } catch (err) {
      setError(err.message);
    } finally {
      busyRef.current = false;
      setBusy(false);
    }
  };

  const onFile = async (e) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToDataUrl(file);
      setSlipPreview(dataUrl);
      await send(dataUrl);
    } catch (err) {
      setError(err.message);
    }
  };

  return (
    <div className="pay-wrap">
      <Card>
        <div className="pay-head">
          <div>
            <div className="eyebrow-dark">ชำระเงินผ่าน QR PromptPay</div>
            <div className="pay-amount">{baht(payment.amount)}</div>
            <div className="small muted">เลขอ้างอิง {payment.ref_code}</div>
          </div>
          <div className={`pay-timer ${expired ? 'expired' : left < 120000 ? 'soon' : ''}`}>
            {expired ? 'QR หมดเวลา' : <>เหลือเวลา <b>{text}</b></>}
          </div>
        </div>

        {/* บิลรายการ — ให้ลูกค้าตรวจก่อนโอน */}
        <div className="pay-bill">
          <div className="pay-bill-head">
            <span className="bold">รายการที่สั่ง</span>
            <span className="tiny muted">{dateTimeOf(payment.created_at)}</span>
          </div>
          <div className="pay-bill-line">
            <div className="grow">
              <div className="bold">{payment.service_name}</div>
              <div className="tiny muted">
                {payment.duration_min ? `ใช้เวลาประมาณ ${payment.duration_min} นาที` : 'บริการของร้าน'}
                {payment.barber_name ? ` · ช่าง ${payment.barber_name}` : ' · ช่างคนไหนว่างก่อนก็ได้'}
              </div>
            </div>
            <span className="mono">{baht(payment.amount)}</span>
          </div>
          <div className="pay-bill-total">
            <span>รวมที่ต้องชำระ</span>
            <span className="mono">{baht(payment.amount)}</span>
          </div>
        </div>

        <div className="pay-qr">
          {payment.qr_code && (
            <img src={payment.qr_code} alt={`QR PromptPay ${payment.amount} บาท`} className={expired ? 'faded' : ''} />
          )}
          <div className="pay-to">
            <div className="tiny muted">โอนเข้าพร้อมเพย์</div>
            <div className="bold">{payment.account_name || 'ร้าน'} · {payment.promptpay_masked}</div>
            <div className="tiny muted mt-1">เลขอ้างอิง {payment.ref_code}</div>
          </div>
          <a className="btn sm" href={payment.qr_code} download={`qr-${payment.ref_code}.png`}>บันทึกรูป QR</a>
        </div>

        <ol className="pay-steps">
          <li>สแกน QR ด้วยแอปธนาคาร (หรือบันทึกรูป QR แล้วเลือกจากอัลบั้มในแอปธนาคาร)</li>
          <li>ตรวจยอดเงินให้ตรง <b>{baht(payment.amount)}</b> แล้วกดโอน</li>
          <li>อัปโหลดสลิปด้านล่าง ระบบจะตรวจสอบและออกบัตรคิวให้ทันที</li>
        </ol>

        {expired && (
          <Alert kind="info">QR นี้หมดเวลาแล้ว ถ้าโอนเงินไปแล้วยังอัปโหลดสลิปได้ หรือกด "เริ่มใหม่" เพื่อสร้าง QR ใหม่</Alert>
        )}
        {error && <Alert kind="error">{error}</Alert>}

        <input ref={fileRef} type="file" accept="image/*" hidden onChange={onFile} />
        <button className="btn primary block lg" onClick={() => fileRef.current?.click()} disabled={busy}>
          {busy ? <><span className="spinner" />กำลังตรวจสอบสลิป...</> : 'อัปโหลดสลิปการโอนเงิน'}
        </button>

        {slipPreview && (
          <div className="center mt-2">
            <img src={slipPreview} alt="สลิปที่อัปโหลด" className="pay-slip-preview" />
          </div>
        )}

        {testMode && (
          <button className="btn block mt-2" onClick={() => send(mockSlip(payment))} disabled={busy}>
            🧪 โหมดทดสอบ: ส่งสลิปจำลอง
          </button>
        )}

        <div className="row-between mt-3">
          <button className="btn ghost sm" onClick={onCancel} disabled={busy}>ยกเลิก / เริ่มใหม่</button>
          <span className="tiny muted">มีปัญหา? แจ้งพนักงานพร้อมเลขอ้างอิง {payment.ref_code}</span>
        </div>
      </Card>

      {/* สแกนครั้งเดียว แล้วรับแจ้งเตือนตอนถึงคิวทาง LINE */}
      <LineQrCard className="mt-3" />
    </div>
  );
}
