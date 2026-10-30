import { useState, useEffect, useCallback, Fragment } from 'react';
import {
  AreaChart, Area, BarChart, Bar, LineChart, Line, PieChart, Pie, Cell,
  XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from 'recharts';
import { api, downloadCsv } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Stat, Empty, Loading, Avatar, baht, minutes, dateOf, SOURCE_LABEL } from '../components/ui.jsx';
import { useTheme } from '../context/ThemeContext.jsx';

const TABS = [
  { key: 'customers', label: 'จำนวนลูกค้า', path: '/reports/customers' },
  { key: 'wait-time', label: 'เวลารอเฉลี่ย', path: '/reports/wait-time' },
  { key: 'barbers', label: 'การให้บริการของช่าง', path: '/reports/barbers' },
  { key: 'sales', label: 'ยอดขาย (POS)', path: '/reports/sales' },
  { key: 'inventory', label: 'สต็อกสินค้า', path: '/reports/inventory' },
];

const METHOD_TH = {
  cash: 'เงินสด', promptpay: 'QR พร้อมเพย์', card: 'บัตร',
  transfer: 'โอน', points: 'แต้ม', other: 'อื่น ๆ',
};

const MOVE_TH = {
  sale: 'ขายออก', restock: 'รับเข้า', adjust: 'ปรับยอด',
  refund: 'คืนสินค้า', void: 'ยกเลิกบิล', damage: 'ของเสีย',
};

const PIE_COLORS = ['#111827', '#dc2626', '#2563eb', '#16a34a', '#d97706'];
const iso = (d) => d.toLocaleDateString('en-CA');

export default function Reports() {
  const toast = useToast();
  const [tab, setTab] = useState('customers');
  const [from, setFrom] = useState(iso(new Date(Date.now() - 29 * 86400000)));
  const [to, setTo] = useState(iso(new Date()));
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const path = TABS.find((t) => t.key === tab).path;
      // ผูกข้อมูลไว้กับแท็บที่ขอ กันไม่ให้ render ข้อมูลของแท็บเก่าตอนกำลังสลับ
      setData({ tab, payload: await api.get(path, { from, to }) });
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, from, to]);

  useEffect(() => { load(); }, [load]);

  const preset = (days) => {
    setFrom(iso(new Date(Date.now() - (days - 1) * 86400000)));
    setTo(iso(new Date()));
  };

  const exportCsv = async () => {
    try {
      // ยอดขายมี endpoint ส่งออกของตัวเอง (คนละชุดข้อมูลกับรายงานคิว)
      const exportPath = tab === 'sales' ? '/reports/sales/export' : '/reports/export';
      await downloadCsv(exportPath, { type: tab, from, to }, `${tab}-${from}-to-${to}.csv`);
      toast.ok('ดาวน์โหลดรายงานเรียบร้อยแล้ว');
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page">
      <div className="row-between page-head wrap gap-3">
        <div>
          <h1>รายงาน</h1>
          <div className="sub">สรุปผลการดำเนินงานระหว่าง {dateOf(from)} — {dateOf(to)}</div>
        </div>
        <button className="btn dark" onClick={exportCsv} disabled={tab === 'inventory'}>⤓ ส่งออก CSV</button>
      </div>

      <Card tight className="mt-2">
        <div className="row-between wrap gap-2" style={{ padding: 4 }}>
          <div className="row gap-1 wrap">
            {TABS.map((t) => (
              <button key={t.key} className={`btn sm ${tab === t.key ? 'dark' : 'ghost'}`}
                onClick={() => setTab(t.key)}>{t.label}</button>
            ))}
          </div>
          <div className="row gap-2 wrap">
            <button className="btn sm ghost" onClick={() => preset(7)}>7 วัน</button>
            <button className="btn sm ghost" onClick={() => preset(30)}>30 วัน</button>
            <input className="input" style={{ height: 32, width: 150 }} type="date"
              value={from} max={to} onChange={(e) => setFrom(e.target.value)} />
            <span className="muted small">ถึง</span>
            <input className="input" style={{ height: 32, width: 150 }} type="date"
              value={to} min={from} onChange={(e) => setTo(e.target.value)} />
          </div>
        </div>
      </Card>

      <div className="mt-4">
        {loading || data?.tab !== tab ? <Loading rows={6} />
          : !data.payload ? <Card><Empty title="โหลดรายงานไม่สำเร็จ" /></Card>
            : tab === 'customers' ? <CustomersReport data={data.payload} />
              : tab === 'wait-time' ? <WaitTimeReport data={data.payload} />
                : tab === 'sales' ? <SalesReport data={data.payload} />
                  : tab === 'inventory' ? <InventoryReport data={data.payload} />
                    : <BarbersReport data={data.payload} />}
      </div>
    </div>
  );
}

const withLabel = (rows) => rows.map((r) => ({
  ...r,
  label: new Date(r.queue_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
}));

/* ------------------------ รายงานจำนวนลูกค้า ------------------------ */
function CustomersReport({ data }) {
  const t = data.totals;
  const chart = withLabel(data.daily);
  const pie = data.by_source.map((s) => ({ name: SOURCE_LABEL[s.source] || s.source, value: s.count }));

  return (
    <>
      <div className="grid grid-4">
        <Stat label="คิวทั้งหมด" value={t.total_tickets} unit="คิว" icon="🎫" />
        <Stat label="ลูกค้า (ไม่ซ้ำ)" value={t.unique_customers} unit="คน" icon="👥" />
        <Stat label="ให้บริการสำเร็จ" value={t.done_count} unit="คิว" icon="✓" />
        <Stat label="รายได้รวม" value={baht(t.revenue)} icon="฿" />
      </div>

      <div className="grid grid-2 mt-4">
        <Card title="จำนวนลูกค้ารายวัน" subtitle="คิวทั้งหมดเทียบกับลูกค้าที่ไม่ซ้ำกัน">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chart} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
              <defs>
                <linearGradient id="rc" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="#111827" stopOpacity={0.2} />
                  <stop offset="100%" stopColor="#111827" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Legend wrapperStyle={{ fontSize: 12 }} />
              <Area type="monotone" dataKey="total_tickets" name="คิวทั้งหมด"
                stroke="#111827" strokeWidth={2} fill="url(#rc)" />
              <Area type="monotone" dataKey="unique_customers" name="ลูกค้า (คน)"
                stroke="#dc2626" strokeWidth={2} fill="none" />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="ช่องทางการรับบัตรคิว" subtitle="สัดส่วนการรับคิวแต่ละช่องทาง">
          {pie.length === 0 ? <Empty title="ยังไม่มีข้อมูล" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={54} outerRadius={92} paddingAngle={2}>
                  {pie.map((_, i) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <Card title="ลูกค้าที่มาใช้บริการบ่อยที่สุด" className="mt-4" tight>
        {data.top_customers.length === 0 ? <Empty title="ยังไม่มีข้อมูล" /> : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>#</th><th>ลูกค้า</th><th>เบอร์โทร</th>
                  <th className="right">จำนวนครั้ง</th><th className="right">ยอดใช้จ่าย</th><th>ล่าสุด</th></tr>
              </thead>
              <tbody>
                {data.top_customers.map((c, i) => (
                  <tr key={c.id}>
                    <td><span className="pos-pill">{i + 1}</span></td>
                    <td>
                      <div className="row gap-2">
                        <Avatar name={c.full_name} size="sm" />
                        <span className="bold small">{c.full_name}</span>
                      </div>
                    </td>
                    <td className="small">{c.phone || '—'}</td>
                    <td className="right bold">{c.visits}</td>
                    <td className="right">{baht(c.spent)}</td>
                    <td className="small muted">{dateOf(c.last_visit)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </>
  );
}

/* ------------------------ รายงานเวลารอเฉลี่ย ----------------------- */
function WaitTimeReport({ data }) {
  const o = data.overall;
  const chart = withLabel(data.daily);
  const byHour = data.by_hour.map((h) => ({ ...h, label: `${String(h.hour).padStart(2, '0')}:00` }));

  return (
    <>
      <div className="grid grid-4">
        <Stat label="เวลารอเฉลี่ย" value={o.avg_wait_min ?? '—'} unit="นาที" icon="⌛" />
        <Stat label="เวลาให้บริการเฉลี่ย" value={o.avg_service_min ?? '—'} unit="นาที" icon="✂" />
        <Stat label="จำนวนคิวที่นำมาคำนวณ" value={o.samples} unit="คิว" icon="📊" />
        <Stat label="รวมเวลาต่อคิวโดยเฉลี่ย"
          value={((o.avg_wait_min ?? 0) + (o.avg_service_min ?? 0)).toFixed(1)} unit="นาที" icon="⏱" />
      </div>

      <Card title="เวลารอเฉลี่ยรายวัน" subtitle="เปรียบเทียบเวลารอกับเวลาให้บริการ (นาที)" className="mt-4">
        <ResponsiveContainer width="100%" height={280}>
          <LineChart data={chart} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
            <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
            <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
            <Legend wrapperStyle={{ fontSize: 12 }} />
            <Line type="monotone" dataKey="avg_wait_min" name="เวลารอเฉลี่ย" stroke="#dc2626" strokeWidth={2} dot={false} />
            <Line type="monotone" dataKey="max_wait_min" name="รอนานสุด" stroke="#f59e0b" strokeWidth={1.5} strokeDasharray="4 3" dot={false} />
            <Line type="monotone" dataKey="avg_service_min" name="เวลาให้บริการ" stroke="#111827" strokeWidth={2} dot={false} />
          </LineChart>
        </ResponsiveContainer>
      </Card>

      <div className="grid grid-2 mt-4">
        <Card title="เวลารอตามช่วงเวลาของวัน" subtitle="ใช้วางแผนกำลังคนในช่วงที่ลูกค้าเยอะ">
          {byHour.length === 0 ? <Empty title="ยังไม่มีข้อมูล" /> : (
            <ResponsiveContainer width="100%" height={250}>
              <BarChart data={byHour} margin={{ top: 4, right: 6, left: -22, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" vertical={false} />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <YAxis tick={{ fontSize: 11 }} stroke="#9ca3af" />
                <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="avg_wait_min" name="เวลารอเฉลี่ย (นาที)" fill="#dc2626" radius={[5, 5, 0, 0]} />
                <Bar dataKey="tickets" name="จำนวนคิว" fill="#111827" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="เวลาจริงเทียบกับเวลาที่กำหนดไว้" subtitle="ดูว่าบริการไหนใช้เวลาเกินที่ตั้งไว้" tight>
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr><th>บริการ</th><th className="right">คิว</th>
                  <th className="right">รอเฉลี่ย</th><th className="right">ทำจริง</th><th className="right">ที่ตั้งไว้</th></tr>
              </thead>
              <tbody>
                {data.by_service.map((s) => {
                  const over = s.avg_service_min && s.avg_service_min > s.planned_min;
                  return (
                    <tr key={s.service_name}>
                      <td className="small bold">{s.service_name}</td>
                      <td className="right small">{s.tickets}</td>
                      <td className="right small">{minutes(s.avg_wait_min)}</td>
                      <td className="right small" style={over ? { color: 'var(--danger)', fontWeight: 600 } : undefined}>
                        {minutes(s.avg_service_min)}
                      </td>
                      <td className="right small muted">{s.planned_min} นาที</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </Card>
      </div>
    </>
  );
}

/* -------------------- รายงานการให้บริการของช่าง -------------------- */
function BarbersReport({ data }) {
  const totalServed = data.summary.reduce((a, b) => a + b.served_count, 0);
  const totalRevenue = data.summary.reduce((a, b) => a + Number(b.revenue), 0);
  const best = [...data.summary].sort((a, b) => b.served_count - a.served_count)[0];

  return (
    <>
      <div className="grid grid-4">
        <Stat label="ให้บริการรวม" value={totalServed} unit="คิว" icon="✂" />
        <Stat label="รายได้รวม" value={baht(totalRevenue)} icon="฿" />
        <Stat label="ช่างทั้งหมด" value={data.summary.length} unit="คน" icon="👥" />
        <Stat label="ช่างที่ทำได้มากที่สุด" value={best?.nickname || best?.full_name || '—'} icon="🏆" />
      </div>

      <div className="grid grid-2 mt-4">
        <Card title="จำนวนคิวที่ให้บริการ" subtitle="เปรียบเทียบผลงานของช่างแต่ละคน">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.summary} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" allowDecimals={false} />
              <YAxis type="category" dataKey="full_name" width={110} tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} />
              <Bar dataKey="served_count" name="คิวที่ให้บริการ" fill="#111827" radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>

        <Card title="รายได้ที่สร้างได้" subtitle="ยอดรวมจากคิวที่ให้บริการเสร็จสิ้น">
          <ResponsiveContainer width="100%" height={280}>
            <BarChart data={data.summary} layout="vertical" margin={{ top: 4, right: 16, left: 10, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <YAxis type="category" dataKey="full_name" width={110} tick={{ fontSize: 11 }} stroke="#9ca3af" />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => baht(v)} />
              <Bar dataKey="revenue" name="รายได้" fill="#dc2626" radius={[0, 5, 5, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </Card>
      </div>

      <Card title="สรุปผลงานรายบุคคล" className="mt-4" tight>
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>ช่าง</th><th>รหัส</th>
                <th className="right">ให้บริการ</th><th className="right">ยกเลิก / ไม่มา</th>
                <th className="right">เวลาเฉลี่ย</th><th className="right">รายได้</th><th className="right">คะแนน</th>
              </tr>
            </thead>
            <tbody>
              {data.summary.map((b) => (
                <tr key={b.barber_id}>
                  <td>
                    <div className="row gap-2">
                      <Avatar name={b.full_name} size="sm" />
                      <div>
                        <div className="bold small">{b.full_name}</div>
                        <div className="tiny muted">{b.nickname || '—'}</div>
                      </div>
                    </div>
                  </td>
                  <td className="small mono">{b.code}</td>
                  <td className="right bold">{b.served_count}</td>
                  <td className="right small muted">{b.cancelled_count} / {b.no_show_count}</td>
                  <td className="right small">{minutes(b.avg_service_min)}</td>
                  <td className="right">{baht(b.revenue)}</td>
                  <td className="right"><span className="badge ok">★ {Number(b.rating).toFixed(2)}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}

/* ------------------------- รายงานยอดขาย (POS) ------------------------- */
function SalesReport({ data }) {
  const { isDark } = useTheme();
  const grid = isDark ? '#2b3344' : '#e5e7eb';
  const axis = isDark ? '#7b8699' : '#9ca3af';
  const line = isDark ? '#ef4444' : '#dc2626';

  const s = data.summary;
  const chart = data.daily.map((r) => ({
    ...r,
    label: new Date(r.sale_date).toLocaleDateString('th-TH', { day: 'numeric', month: 'short' }),
    net_total: Number(r.net_total),
  }));
  const pie = data.payment_methods.map((m) => ({ name: METHOD_TH[m.method] || m.method, value: Number(m.total) }));

  return (
    <>
      <div className="grid grid-4">
        <Stat label="จำนวนบิล" value={s.bills} unit="บิล" icon="🧾" />
        <Stat label="ยอดขายสุทธิ" value={baht(s.net_total)} icon="💰" />
        <Stat label="ยอดเฉลี่ยต่อบิล" value={baht(s.avg_bill)} icon="📊" />
        <Stat label="ส่วนลดที่ให้ไป" value={baht(Number(s.discount) + Number(s.points_discount))} icon="🏷" />
      </div>

      <div className="grid grid-2 mt-4">
        <Card title="ยอดขายรายวัน" subtitle="ยอดสุทธิหลังหักคืนเงิน">
          <ResponsiveContainer width="100%" height={260}>
            <AreaChart data={chart} margin={{ top: 4, right: 6, left: -12, bottom: 0 }}>
              <defs>
                <linearGradient id="sl" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor={line} stopOpacity={0.3} />
                  <stop offset="100%" stopColor={line} stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid strokeDasharray="3 3" stroke={grid} vertical={false} />
              <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke={axis} />
              <YAxis tick={{ fontSize: 11 }} stroke={axis} />
              <Tooltip contentStyle={{ fontSize: 12, borderRadius: 8 }} formatter={(v) => baht(v)} />
              <Area type="monotone" dataKey="net_total" name="ยอดสุทธิ" stroke={line} fill="url(#sl)" strokeWidth={2} />
            </AreaChart>
          </ResponsiveContainer>
        </Card>

        <Card title="แยกตามวิธีชำระเงิน">
          {pie.length === 0 ? <Empty icon="💳" title="ยังไม่มีข้อมูลการชำระเงิน" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <PieChart>
                <Pie data={pie} dataKey="value" nameKey="name" innerRadius={55} outerRadius={92} paddingAngle={2}>
                  {pie.map((entry, i) => <Cell key={entry.name} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip formatter={(v) => baht(v)} contentStyle={{ fontSize: 12, borderRadius: 8 }} />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      <div className="grid grid-2 mt-4">
        <Card title="ขายดีที่สุด" subtitle="บริการและสินค้ารวมกัน" tight>
          {data.top_items.length === 0 ? <Empty icon="📦" title="ยังไม่มียอดขาย" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>รายการ</th><th>ประเภท</th><th className="right">จำนวน</th><th className="right">ยอดขาย</th></tr>
                </thead>
                <tbody>
                  {data.top_items.map((it) => (
                    <tr key={`${it.kind}-${it.name}`}>
                      <td className="bold">{it.name}</td>
                      <td><span className="badge">{it.kind === 'service' ? 'บริการ' : 'สินค้า'}</span></td>
                      <td className="right mono">{it.qty}</td>
                      <td className="right mono bold">{baht(it.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="ยอดขายแยกตามช่าง" tight>
          {data.by_barber.length === 0 ? <Empty icon="✂" title="ยังไม่มีข้อมูล" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>ช่าง</th><th className="right">บิล</th><th className="right">รายการ</th><th className="right">ยอดขาย</th></tr>
                </thead>
                <tbody>
                  {data.by_barber.map((b) => (
                    <tr key={b.barber_id}>
                      <td>
                        <div className="bold small">{b.barber_name}</div>
                        <div className="tiny muted">{b.code}</div>
                      </td>
                      <td className="right mono">{b.bills}</td>
                      <td className="right mono">{b.items}</td>
                      <td className="right mono bold">{baht(b.revenue)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      {data.promo_usage.length > 0 && (
        <Card title="การใช้โค้ดส่วนลด" className="mt-4" tight>
          <div className="table-wrap">
            <table className="data">
              <thead><tr><th>โค้ด</th><th className="right">ใช้ไป</th><th className="right">ส่วนลดรวม</th></tr></thead>
              <tbody>
                {data.promo_usage.map((p) => (
                  <tr key={p.promo_code}>
                    <td className="bold mono">{p.promo_code}</td>
                    <td className="right mono">{p.uses} ครั้ง</td>
                    <td className="right mono">{baht(p.discount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </>
  );
}

/* --------------------------- รายงานสต็อก --------------------------- */
function InventoryReport({ data }) {
  const v = data.stock_value;

  return (
    <>
      <div className="grid grid-4">
        <Stat label="สินค้าที่ตัดสต็อก" value={v.products} unit="รายการ" icon="📦" />
        <Stat label="จำนวนคงเหลือรวม" value={Number(v.units).toLocaleString('th-TH')} unit="ชิ้น" icon="🔢" />
        <Stat label="มูลค่าต้นทุน" value={baht(v.cost_value)} icon="💰" />
        <Stat label="มูลค่าขาย" value={baht(v.retail_value)} icon="🏷" />
      </div>

      <div className="grid grid-2 mt-4">
        <Card title="สินค้าใกล้หมด" subtitle="ถึงจุดเตือนที่ตั้งไว้แล้ว ควรสั่งเพิ่ม" tight>
          {data.low_stock.length === 0 ? (
            <Empty icon="✅" title="สต็อกเพียงพอทุกรายการ" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr><th>สินค้า</th><th>หมวด</th><th className="right">คงเหลือ</th><th className="right">จุดเตือน</th></tr>
                </thead>
                <tbody>
                  {data.low_stock.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="bold small">{p.name}</div>
                        <div className="tiny muted">{p.sku || '—'}</div>
                      </td>
                      <td className="tiny">{p.category}</td>
                      <td className="right"><span className="badge warn">{p.stock_qty}</span></td>
                      <td className="right mono muted">{p.low_stock_level}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>

        <Card title="สินค้าที่ขายช้า" subtitle="ขายได้น้อยที่สุดในช่วงที่เลือก" tight>
          {data.slow_movers.length === 0 ? <Empty icon="📦" title="ยังไม่มีข้อมูล" /> : (
            <div className="table-wrap">
              <table className="data">
                <thead><tr><th>สินค้า</th><th className="right">ขายได้</th><th className="right">คงเหลือ</th></tr></thead>
                <tbody>
                  {data.slow_movers.map((p) => (
                    <tr key={p.id}>
                      <td>
                        <div className="bold small">{p.name}</div>
                        <div className="tiny muted">{p.sku || '—'}</div>
                      </td>
                      <td className="right mono">{p.sold_qty}</td>
                      <td className="right mono">{p.stock_qty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <Card title="การเคลื่อนไหวสต็อกในช่วงที่เลือก" className="mt-4">
        {data.movements.length === 0 ? <Empty icon="📋" title="ไม่มีการเคลื่อนไหว" /> : (
          <div className="dl">
            {data.movements.map((m) => (
              <Fragment key={m.reason}>
                <dt>{MOVE_TH[m.reason] || m.reason}</dt>
                <dd>{m.units} ชิ้น ({m.entries} ครั้ง)</dd>
              </Fragment>
            ))}
          </div>
        )}
      </Card>
    </>
  );
}
