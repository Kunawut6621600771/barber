import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Card, StatusBadge, Empty, Loading, ConfirmModal,
  baht, timeOf, dateOf, sinceMinutes, SOURCE_LABEL,
} from '../components/ui.jsx';
import LineQrCard from '../components/LineQrCard.jsx';

export default function MyQueue() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [mine, current] = await Promise.all([api.get('/queue/my'), api.get('/queue/current')]);
      setData(mine);
      setBoard(current);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ 'queue:update': load, 'queue:called': load, notification: load });

  const cancel = async () => {
    setCancelling(true);
    try {
      const d = await api.post(`/queue/${data.ticket.id}/cancel`, { reason: 'ลูกค้ายกเลิกเอง' });
      toast.ok(d.message);
      setConfirmOpen(false);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setCancelling(false);
    }
  };

  if (loading) return <div className="page"><Loading rows={5} /></div>;

  const t = data?.ticket;

  return (
    <div className="page">
      <div className="page-head">
        <h1>คิวของฉัน</h1>
        <div className="sub">ติดตามสถานะคิวของคุณแบบเรียลไทม์</div>
      </div>

      {!t ? (
        <Card>
          <Empty icon="🎫" title="คุณยังไม่มีคิวที่รออยู่"
            hint="กดรับบัตรคิวเพื่อเข้าคิวรับบริการ" />
          <div className="center">
            <Link to="/app/take-queue" className="btn primary lg">รับบัตรคิว</Link>
          </div>
        </Card>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 340px)' }}>
          <div className="col gap-4">
            <div className="ticket-hero">
              <div>
                <div className="eyebrow">หมายเลขคิวของคุณ</div>
                <div className="number">{t.ticket_no}</div>
                <div className="row gap-2 wrap">
                  <StatusBadge status={t.status} />
                  <span className="badge dark">{SOURCE_LABEL[t.source]}</span>
                </div>
              </div>

              <div className="mt-4">
                {t.status === 'waiting' && (
                  <>
                    <div style={{ fontSize: 15 }}>
                      เหลืออีก <b style={{ fontSize: 28 }}>{data.remaining}</b> คิวก่อนถึงคุณ
                    </div>
                    <div className="meta mt-1">
                      รอโดยประมาณอีก {data.estimated_wait_min} นาที · รอมาแล้ว {sinceMinutes(t.issued_at)} นาที
                    </div>
                  </>
                )}
                {t.status === 'called' && (
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#fca5a5' }}>
                    📢 ถึงคิวของคุณแล้ว! กรุณาติดต่อพนักงานที่เคาน์เตอร์
                  </div>
                )}
                {t.status === 'serving' && (
                  <div style={{ fontSize: 17, fontWeight: 600, color: '#fcd34d' }}>
                    ✂ กำลังให้บริการโดยช่าง {t.barber_name}
                  </div>
                )}
              </div>
            </div>

            <Card title="รายละเอียดคิว" tight>
              <div className="queue-row"><div className="grow muted small">บริการ</div>
                <div className="bold">{t.service_name}</div></div>
              <div className="queue-row"><div className="grow muted small">ระยะเวลาโดยประมาณ</div>
                <div className="bold">{t.duration_min} นาที</div></div>
              <div className="queue-row"><div className="grow muted small">ราคา</div>
                <div className="bold">{baht(t.price)}</div></div>
              <div className="queue-row"><div className="grow muted small">ช่างที่ให้บริการ</div>
                <div className="bold">{t.barber_name || 'ช่างที่ว่างก่อน'}</div></div>
              <div className="queue-row"><div className="grow muted small">เวลารับบัตรคิว</div>
                <div className="bold">{timeOf(t.issued_at)}</div></div>
            </Card>

            {['waiting', 'called'].includes(t.status) && (
              <button className="btn danger" onClick={() => setConfirmOpen(true)}>ยกเลิกคิวนี้</button>
            )}
          </div>

          <div className="col gap-4">
            <LineQrCard ticketId={t.id} />
            <Card title="สถานะคิวหน้าร้าน" subtitle={`กำลังรอทั้งหมด ${board?.waiting_count ?? 0} คิว`} tight>
              {board?.now_serving?.length ? board.now_serving.map((q) => (
                <div key={q.id} className="queue-row is-serving">
                  <div className="qno">{q.ticket_no}</div>
                  <div className="grow small">{q.service_name}</div>
                  <span className="badge warn">กำลังให้บริการ</span>
                </div>
              )) : <div className="small muted center" style={{ padding: 14 }}>ยังไม่มีคิวที่กำลังให้บริการ</div>}

              {board?.waiting?.slice(0, 6).map((q) => (
                <div key={q.id} className="queue-row" style={q.id === t.id ? { background: 'var(--brand-soft)' } : undefined}>
                  <div className="pos-pill">{q.position}</div>
                  <div className="qno">{q.ticket_no}</div>
                  <div className="grow small muted">{q.id === t.id ? 'คิวของคุณ' : q.service_name}</div>
                </div>
              ))}
            </Card>
          </div>
        </div>
      )}

      {data?.history?.length > 0 && (
        <Card title="ประวัติการใช้บริการ" className="mt-4" tight>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>วันที่</th><th>คิว</th><th>บริการ</th><th>ช่าง</th><th>ราคา</th><th>สถานะ</th></tr>
              </thead>
              <tbody>
                {data.history.map((h) => (
                  <tr key={h.id}>
                    <td className="small">{dateOf(h.queue_date)}</td>
                    <td className="bold mono small">{h.ticket_no}</td>
                    <td className="small">{h.service_name}</td>
                    <td className="small">{h.barber_name || '—'}</td>
                    <td className="small">{baht(h.price)}</td>
                    <td><StatusBadge status={h.status} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <ConfirmModal
        open={confirmOpen}
        title="ยืนยันการยกเลิกคิว"
        message={`ต้องการยกเลิกคิว ${t?.ticket_no} ใช่หรือไม่? หากยกเลิกแล้วต้องรับบัตรคิวใหม่และเริ่มรอใหม่ตั้งแต่ต้น`}
        confirmText="ยกเลิกคิว" danger busy={cancelling}
        onClose={() => setConfirmOpen(false)} onConfirm={cancel}
      />
    </div>
  );
}
