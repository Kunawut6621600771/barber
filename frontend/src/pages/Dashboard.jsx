import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import {
  AreaChart, Area, BarChart, Bar, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer,
} from 'recharts';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Card, Stat, StatusBadge, BarberBadge, Avatar, Empty, Loading,
  baht, minutes, timeOf, sinceMinutes,
} from '../components/ui.jsx';

export default function Dashboard() {
  const toast = useToast();
  const [data, setData] = useState(null);
  const [trend, setTrend] = useState([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);

  const load = useCallback(async () => {
    try {
      const [summary, tr] = await Promise.all([
        api.get('/dashboard/summary'),
        api.get('/dashboard/trend', { days: 14 }),
      ]);
      setData(summary);
      setTrend(tr.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ 'queue:update': load, 'barber:update': load });

  const callNext = async () => {
    setActing(true);
    try {
      const d = await api.post('/queue/call', {});
      toast.ok(d.message);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setActing(false);
    }
  };

  if (loading) return <div className="page"><Loading rows={6} /></div>;
  if (!data) return <div className="page"><Empty title="โหลดข้อมูลไม่สำเร็จ" /></div>;

  const s = data.stats;
  const chartTrend = trend.map((t) => ({
    ...t,
    label: new Date(t.queue_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
  }));
  const chartHourly = data.hourly.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }));

  return (
    <div className="page">
      <div className="row-between page-head">
        <div>
          <h1>ภาพรวมวันนี้</h1>
          <div className="sub">
            {new Date(data.date).toLocaleDateString('th-TH', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}
            {' · '}อัปเดตอัตโนมัติแบบเรียลไทม์
          </div>
        </div>
        <div className="row gap-2">
          <Link to="/app/queue" className="btn">จัดการคิว</Link>
          <button className="btn primary" onClick={callNext} disabled={acting || s.waiting_count === 0}>
            {acting && <span className="spinner" />}เรียกคิวถัดไป
          </button>
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="คิวทั้งหมดวันนี้" value={s.total_tickets} unit="คิว" icon="🎫" />
        <Stat label="กำลังรอ" value={s.waiting_count} unit="คิว" icon="⏳"
          tone={s.waiting_count > 8 ? 'var(--danger)' : undefined} />
        <Stat label="เสร็จสิ้นแล้ว" value={s.done_count} unit="คิว" icon="✓" />
        <Stat label="เวลารอเฉลี่ย" value={s.avg_wait_min ?? '—'} unit="นาที" icon="⌛" />
      </div>

      <div className="grid grid-4 mt-3">
        <Stat label="ลูกค้า (คน)" value={s.unique_customers} icon="👥" />
        <Stat label="กำลังให้บริการ" value={s.active_count} unit="คิว" icon="✂" />
        <Stat label="ยกเลิก / ไม่มา" value={`${s.cancelled_count} / ${s.no_show_count}`} icon="✕" />
        <Stat label="รายได้วันนี้" value={baht(s.revenue)} icon="฿" />
      </div>

      <div className="grid mt-4" style={{ gridTemplateColumns: 'minmax(0, 1.35fr) minmax(0, 1fr)' }}>
        {/* ---------------- คิวที่กำลังให้บริการ + คิวที่รอ ---------------- */}
        <div className="col gap-4">
          <Card
            title="คิวปัจจุบัน"
            subtitle="คิวที่เรียกแล้วและกำลังให้บริการ"
            action={<Link to="/app/queue" className="btn sm">ดูทั้งหมด</Link>}
            tight
          >
            {data.now_serving.length === 0 ? (
              <Empty icon="💈" title="ยังไม่มีคิวที่กำลังให้บริการ" hint="กด “เรียกคิวถัดไป” เพื่อเริ่มต้น" />
            ) : (
              data.now_serving.map((t) => (
                <div key={t.id} className={`queue-row ${t.status === 'serving' ? 'is-serving' : 'is-called'}`}>
                  <div className="qno">{t.ticket_no}</div>
                  <div className="grow">
                    <div className="bold">{t.customer_name}</div>
                    <div className="small muted">{t.service_name} · {t.duration_min} นาที · {baht(t.price)}</div>
                  </div>
                  <div className="right">
                    <StatusBadge status={t.status} />
                    <div className="tiny muted mt-1">
                      {t.status === 'serving'
                        ? `เริ่ม ${timeOf(t.started_at)} (${sinceMinutes(t.started_at)} นาทีที่แล้ว)`
                        : `เรียกเมื่อ ${timeOf(t.called_at)}`}
                    </div>
                  </div>
                  <div className="row gap-2" style={{ minWidth: 96 }}>
                    <Avatar name={t.barber_name || '—'} size="sm" />
                    <div className="tiny">{t.barber_name || 'ยังไม่ระบุช่าง'}</div>
                  </div>
                </div>
              ))
            )}
          </Card>

          <Card title="คิวที่รอ" subtitle={`ทั้งหมด ${s.waiting_count} คิว`} tight>
            {data.waiting.length === 0 ? (
              <Empty icon="✅" title="ไม่มีคิวรออยู่" hint="ลูกค้าทุกคนได้รับบริการเรียบร้อยแล้ว" />
            ) : (
              data.waiting.map((t) => (
                <div key={t.id} className="queue-row">
                  <div className="pos-pill">{t.position}</div>
                  <div className="qno">{t.ticket_no}</div>
                  <div className="grow">
                    <div className="bold">{t.customer_name}</div>
                    <div className="small muted">{t.service_name}</div>
                  </div>
                  <div className="right small muted">
                    รอมา {sinceMinutes(t.issued_at)} นาที
                    <div className="tiny">รับบัตร {timeOf(t.issued_at)}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>

        {/* ------------------------- ช่างตัดผม ------------------------- */}
        <div className="col gap-4">
          <Card title="ช่างที่กำลังให้บริการ" subtitle={`ทีมงาน ${data.barbers.length} คน`} tight>
            {data.barbers.map((b) => (
              <div key={b.id} className="queue-row">
                <Avatar name={b.full_name} />
                <div className="grow">
                  <div className="bold small">{b.full_name}</div>
                  <div className="tiny muted">
                    {b.current_ticket
                      ? `${b.current_ticket.ticket_no} · ${b.current_ticket.service_name}`
                      : `${b.code} · วันนี้ ${b.served_today} คิว`}
                  </div>
                </div>
                <BarberBadge status={b.status} />
              </div>
            ))}
          </Card>

          <Card title="บริการยอดนิยมวันนี้" tight>
            {data.top_services.length === 0 ? (
              <Empty icon="📊" title="ยังไม่มีข้อมูล" />
            ) : (
              data.top_services.map((sv, i) => (
                <div key={sv.name} className="queue-row">
                  <div className="pos-pill">{i + 1}</div>
                  <div className="grow small bold">{sv.name}</div>
                  <div className="right">
                    <div className="small bold">{sv.count} คิว</div>
                    <div className="tiny muted">{baht(sv.revenue)}</div>
                  </div>
                </div>
              ))
            )}
          </Card>
        </div>
      </div>

      {/* ---------------------------- กราฟ ---------------------------- */}
      <div className="grid grid-2 mt-4">
        <Card title="แนวโน้มจำนวนคิว 14 วัน" subtitle="จำนวนคิวทั้งหมดเทียบกับคิวที่เสร็จสิ้น">
          <ResponsiveContainer width="100%" height={230}>
            <AreaChart data={chartTrend} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="gTotal" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#111827" stopOpacity={0.22} />
                  <stop offset="100%" stopColor="#111827" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Area type="monotone" dataKey="total_tickets" name="คิวทั้งหมด"
                stroke="#111827" strokeWidth={2} fill="url(#gTotal)" />
              <Area type="monotone" dataKey="done_count" name="เสร็จสิ้น"
                stroke="#dc2626" strokeWidth={2} fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="ช่วงเวลาที่คนเยอะ" subtitle="จำนวนคิวที่ออกบัตรแยกตามชั่วโมง">
          {chartHourly.length === 0 ? (
            <Empty icon="🕐" title="ยังไม่มีคิววันนี้" />
          ) : (
            <ResponsiveContainer width="100%" height={230}>
              <BarChart data={chartHourly} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Bar dataKey="tickets" name="จำนวนคิว" fill="#111827" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <p className="tiny muted mt-3">
        เวลาให้บริการเฉลี่ย {minutes(s.avg_service_min)} · เชื่อมต่อแบบเรียลไทม์อยู่ {data.realtime_clients} เครื่อง
      </p>
    </div>
  );
}
