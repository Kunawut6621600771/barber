import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { timeOf } from '../components/ui.jsx';

/** จอแสดงคิวหน้าร้าน (สาธารณะ ไม่ต้องเข้าสู่ระบบ) */
export default function Board() {
  const [data, setData] = useState(null);
  const [clock, setClock] = useState(new Date());

  const load = useCallback(() => {
    api.get('/queue/current').then(setData).catch(() => {});
  }, []);

  useEffect(() => {
    load();
    // เผื่อกรณี SSE หลุด ให้ดึงข้อมูลซ้ำทุก 20 วินาที
    const poll = setInterval(load, 20_000);
    const tick = setInterval(() => setClock(new Date()), 1000);
    return () => { clearInterval(poll); clearInterval(tick); };
  }, [load]);

  useRealtime({ 'queue:update': load, 'queue:called': load, 'queue:cancelled': load });

  const serving = data?.now_serving?.[0] || data?.called?.[0] || null;
  const upNext = [...(data?.called ?? []), ...(data?.waiting ?? [])]
    .filter((t) => t.id !== serving?.id)
    .slice(0, 8);

  return (
    <div className="board">
      <div className="row-between" style={{ marginBottom: 24 }}>
        <div className="row gap-3">
          <div className="sidebar-brand" style={{ border: 'none', padding: 0, margin: 0 }}>
            <div className="mark">T</div>
            <div>
              <div className="name" style={{ fontSize: 18 }}>Trim &amp; Co.</div>
              <div className="sub">ระบบเรียกคิวร้านตัดผม</div>
            </div>
          </div>
        </div>
        <div className="right">
          <div style={{ fontSize: 30, fontWeight: 700, fontVariantNumeric: 'tabular-nums' }}>
            {clock.toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
          </div>
          <div className="small" style={{ color: 'var(--ink-400)' }}>
            {clock.toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
          </div>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 1.1fr)', gap: 20 }}>
        <div className="board-now">
          <div className="small" style={{ color: 'var(--ink-400)', letterSpacing: '.08em' }}>ขณะนี้เรียกคิว</div>
          <div className="n" style={{ color: serving ? '#fff' : 'var(--ink-500)' }}>
            {serving?.ticket_no || '—'}
          </div>
          {serving ? (
            <>
              <div style={{ fontSize: 18, marginTop: 8 }}>{serving.customer_name}</div>
              <div className="small" style={{ color: 'var(--ink-400)', marginTop: 4 }}>
                {serving.service_name}
                {serving.barber_name && ` · ช่าง ${serving.barber_name}`}
              </div>
              <div className="badge dark mt-3" style={{ background: 'var(--brand)' }}>
                {serving.status === 'serving' ? 'กำลังให้บริการ' : 'เชิญที่เคาน์เตอร์'}
              </div>
            </>
          ) : (
            <div className="small" style={{ color: 'var(--ink-500)', marginTop: 8 }}>ยังไม่มีคิวที่ถูกเรียก</div>
          )}
        </div>

        <div>
          <div className="row-between" style={{ marginBottom: 12 }}>
            <h2 style={{ color: '#fff' }}>คิวถัดไป</h2>
            <span className="badge dark">รออยู่ {data?.waiting_count ?? 0} คิว</span>
          </div>

          {upNext.length === 0 ? (
            <div className="board-next">
              <div className="item" style={{ gridColumn: '1 / -1', color: 'var(--ink-400)' }}>
                ไม่มีคิวที่รออยู่ในขณะนี้
              </div>
            </div>
          ) : (
            <div className="board-next">
              {upNext.map((t) => (
                <div key={t.id} className="item">
                  <div className="n">{t.ticket_no}</div>
                  <div className="tiny" style={{ color: 'var(--ink-400)', marginTop: 4 }}>{t.service_name}</div>
                  <div className="tiny" style={{ color: 'var(--ink-500)' }}>
                    {t.status === 'called' ? 'เรียกแล้ว' : `รับบัตร ${timeOf(t.issued_at)}`}
                  </div>
                </div>
              ))}
            </div>
          )}

          <div className="row gap-4 mt-4" style={{ color: 'var(--ink-400)' }}>
            <div><b style={{ color: '#fff', fontSize: 22 }}>{data?.done_count ?? 0}</b> <span className="small">ให้บริการแล้ววันนี้</span></div>
            <div><b style={{ color: '#fff', fontSize: 22 }}>{data?.serving_count ?? 0}</b> <span className="small">กำลังให้บริการ</span></div>
            <div><b style={{ color: '#fff', fontSize: 22 }}>{data?.total_count ?? 0}</b> <span className="small">คิวทั้งหมด</span></div>
          </div>
        </div>
      </div>

      <p className="small center mt-5" style={{ color: 'var(--ink-500)' }}>
        สแกน QR Code หน้าร้านเพื่อรับบัตรคิวและติดตามสถานะคิวของคุณบนมือถือ
      </p>
    </div>
  );
}
