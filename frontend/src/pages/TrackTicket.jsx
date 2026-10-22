import { useState, useEffect, useCallback } from 'react';
import { useParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { StatusBadge, Loading, Empty, baht, timeOf } from '../components/ui.jsx';

/** ติดตามคิวผ่าน QR — เข้าถึงได้โดยไม่ต้องเข้าสู่ระบบ */
export default function TrackTicket() {
  const { token } = useParams();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    api.get(`/queue/track/${token}`)
      .then(setData)
      .catch((err) => setError(err.message))
      .finally(() => setLoading(false));
  }, [token]);

  useEffect(() => {
    load();
    const poll = setInterval(load, 15_000);
    return () => clearInterval(poll);
  }, [load]);

  useRealtime({ 'queue:update': load, 'queue:called': load });

  if (loading) return <div className="page" style={{ maxWidth: 520, margin: '0 auto' }}><Loading rows={4} /></div>;

  if (error) {
    return (
      <div className="page" style={{ maxWidth: 520, margin: '0 auto' }}>
        <div className="card"><div className="card-body">
          <Empty icon="🔍" title={error} hint="บัตรคิวอาจหมดอายุแล้ว หรือลิงก์ไม่ถูกต้อง" />
          <div className="center"><Link to="/login" className="btn">ไปหน้าเข้าสู่ระบบ</Link></div>
        </div></div>
      </div>
    );
  }

  const t = data.ticket;
  const active = t.status === 'waiting';

  return (
    <div className="page" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="ticket-hero">
        <div>
          <div className="eyebrow">หมายเลขคิวของคุณ</div>
          <div className="number">{t.ticket_no}</div>
          <StatusBadge status={t.status} />
        </div>

        <div className="mt-4">
          {active && (
            <>
              <div style={{ fontSize: 15 }}>
                เหลืออีก <b style={{ fontSize: 30 }}>{data.remaining}</b> คิวก่อนถึงคุณ
              </div>
              <div className="meta mt-1">รอโดยประมาณอีก {data.estimated_wait_min} นาที</div>
            </>
          )}
          {t.status === 'called' && (
            <div style={{ fontSize: 17, fontWeight: 600, color: '#fca5a5' }}>
              📢 ถึงคิวของคุณแล้ว! กรุณาติดต่อพนักงาน
            </div>
          )}
          {t.status === 'serving' && (
            <div style={{ fontSize: 17, fontWeight: 600, color: '#fcd34d' }}>
              ✂ กำลังให้บริการโดยช่าง {t.barber_name}
            </div>
          )}
          {['done', 'cancelled', 'no_show'].includes(t.status) && (
            <div className="meta">คิวนี้สิ้นสุดแล้ว ขอบคุณที่ใช้บริการ</div>
          )}
        </div>
      </div>

      <div className="card mt-3">
        <div className="card-body">
          <div className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted small">บริการ</span><span className="bold">{t.service_name}</span>
          </div>
          <div className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted small">ระยะเวลา</span><span className="bold">{t.duration_min} นาที</span>
          </div>
          <div className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted small">ราคา</span><span className="bold">{baht(t.price)}</span>
          </div>
          <div className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted small">ช่าง</span><span className="bold">{t.barber_name || 'ช่างที่ว่างก่อน'}</span>
          </div>
          <div className="row-between" style={{ padding: '7px 0' }}>
            <span className="muted small">เวลารับบัตรคิว</span><span className="bold">{timeOf(t.issued_at)}</span>
          </div>
        </div>
      </div>

      <p className="small muted center mt-3">หน้านี้อัปเดตอัตโนมัติ ไม่ต้องรีเฟรช</p>
      <p className="center mt-2"><Link to="/login" className="btn sm">เข้าสู่ระบบเพื่อรับการแจ้งเตือน</Link></p>
    </div>
  );
}
