import { useCallback, useEffect, useRef, useState } from 'react';
import { api } from '../api/client.js';
import { Card } from './ui.jsx';

/**
 * การ์ด "สแกนเพื่อรับแจ้งเตือนคิวทาง LINE"
 *
 * ลูกค้าสแกน QR ด้วยมือถือ -> LINE เปิดห้องแชทของร้านพร้อมข้อความที่มีรหัสอยู่แล้ว
 * -> กดส่ง -> ระบบผูกบัญชีให้อัตโนมัติ แล้วการ์ดนี้เปลี่ยนเป็นสถานะ "เชื่อมแล้ว" เอง
 *
 * ใช้ได้ทั้งตอนเปิดเว็บบนคอมพิวเตอร์ (สแกนจากจอ) และบนมือถือ (กดปุ่มเปิดแอป LINE)
 */
export default function LineQrCard({ ticketId, title, compact = false, className = '', onLinked }) {
  const [state, setState] = useState(null);
  const [copied, setCopied] = useState(false);
  const linkedRef = useRef(false);

  // เก็บ callback ไว้ใน ref เพื่อไม่ให้ load เปลี่ยนตัวตนทุกครั้งที่ parent re-render
  // (ถ้า load เปลี่ยน effect จะยิงซ้ำไม่จบ เพราะมันเรียก setState)
  const onLinkedRef = useRef(onLinked);
  useEffect(() => { onLinkedRef.current = onLinked; }, [onLinked]);

  const load = useCallback(async () => {
    try {
      const d = await api.get('/line/link-qr', ticketId ? { ticket_id: ticketId } : undefined);
      setState(d);
      if (d.linked && !linkedRef.current) {
        linkedRef.current = true;
        onLinkedRef.current?.(d);
      }
      return d.linked;
    } catch {
      setState({ linked: false, available: false });
      return true;      // เรียก API ไม่ได้ -> หยุดถามซ้ำ
    }
  }, [ticketId]);

  useEffect(() => { load(); }, [load]);

  // ถามสถานะเป็นระยะจนกว่าจะผูกสำเร็จ
  useEffect(() => {
    if (state?.linked || state?.available === false) return undefined;
    const t = setInterval(() => { load(); }, 4000);
    return () => clearInterval(t);
  }, [state?.linked, state?.available, load]);

  if (!state) return null;
  if (state.available === false && !state.linked) return null;   // ร้านยังไม่ได้ตั้งค่า LINE
  if (compact && state.linked) return null;

  if (state.linked) {
    return (
      <Card className={className}>
        <div className="row gap-2">
          {state.picture_url
            ? <img src={state.picture_url} alt="" className="line-pic" />
            : <span className="line-dot">L</span>}
          <div className="grow">
            <div className="bold">
              เชื่อม LINE เรียบร้อยแล้ว{state.display_name ? ` · ${state.display_name}` : ''}
            </div>
            <div className="tiny muted">เราจะแจ้งเตือนในแชท LINE เมื่อใกล้ถึงคิวและเมื่อถึงคิวของคุณ</div>
          </div>
          <span className="badge ok"><i className="dot-i" />พร้อมแจ้งเตือน</span>
        </div>
      </Card>
    );
  }

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(state.message);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch { /* เบราว์เซอร์ไม่อนุญาต -> ให้ลูกค้าพิมพ์เอง */ }
  };

  return (
    <Card
      className={`line-qr-card ${className}`}
      title={title ?? 'รับแจ้งเตือนคิวทาง LINE'}
      subtitle="สแกนครั้งเดียว แล้วเราจะทักไปบอกเมื่อถึงคิวของคุณ"
    >
      <div className="line-qr-body">
        <div className="line-qr-img">
          {state.qr_code && <img src={state.qr_code} alt="QR เชื่อมบัญชี LINE" />}
          <div className="line-qr-code">{state.code}</div>
        </div>

        <div className="grow">
          <ol className="line-qr-steps">
            <li>เปิดแอป <b>LINE</b> แล้วสแกน QR นี้</li>
            <li>กด <b>เพิ่มเพื่อน</b> บัญชีทางการของร้าน</li>
            <li>กด <b>ส่ง</b> ข้อความที่ระบบพิมพ์ไว้ให้แล้ว</li>
          </ol>

          <div className="line-qr-msg">
            <span className="tiny muted">ข้อความที่จะส่ง</span>
            <div className="row gap-2">
              <code className="grow">{state.message}</code>
              <button className="btn sm" onClick={copy}>{copied ? 'คัดลอกแล้ว' : 'คัดลอก'}</button>
            </div>
          </div>

          <div className="row gap-2 mt-2 wrap">
            {state.url && (
              <a className="btn line sm" href={state.url} target="_blank" rel="noreferrer">
                เปิดในแอป LINE
              </a>
            )}
            {state.add_friend_url && (
              <a className="btn sm" href={state.add_friend_url} target="_blank" rel="noreferrer">
                เพิ่มเพื่อนอย่างเดียว
              </a>
            )}
          </div>

          <div className="row gap-2 mt-2">
            <span className="spinner" style={{ width: 12, height: 12, color: 'var(--ink-400)' }} />
            <span className="tiny muted">กำลังรอการเชื่อมบัญชี… หน้านี้จะอัปเดตเองเมื่อสำเร็จ</span>
          </div>
        </div>
      </div>
    </Card>
  );
}
