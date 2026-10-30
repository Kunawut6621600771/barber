import { useCallback, useEffect, useState } from 'react';
import { api, downloadCsv } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, Modal, Field, Empty, Loading, Stat, Switch, baht, dateOf, dateTimeOf, timeOf,
} from '../components/ui.jsx';
import Receipt, { METHOD_LABEL } from '../components/Receipt.jsx';

const STATUS = {
  open: { label: 'เปิดค้างอยู่', cls: 'warn' },
  paid: { label: 'ชำระแล้ว', cls: 'ok' },
  partial_refund: { label: 'คืนเงินบางส่วน', cls: 'info' },
  refunded: { label: 'คืนเงินเต็ม', cls: 'info' },
  void: { label: 'ยกเลิก', cls: 'danger' },
};

const todayStr = () => new Date().toLocaleDateString('en-CA');

export default function Sales() {
  const toast = useToast();
  const { user } = useAuth();

  const [from, setFrom] = useState(todayStr());
  const [to, setTo] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [q, setQ] = useState('');

  const [data, setData] = useState({ data: [], summary: null });
  const [loading, setLoading] = useState(true);
  const [detail, setDetail] = useState(null);
  const [refundFor, setRefundFor] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setData(await api.get('/pos/sales', { from, to, status: status || undefined, q: q || undefined, limit: 200 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [from, to, status, q, toast]);

  useEffect(() => { load(); }, [load]);

  const openDetail = async (sale) => {
    try {
      setDetail(await api.get(`/pos/sales/${sale.id}/receipt`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  const quickRange = (days) => {
    const end = new Date();
    const start = new Date(Date.now() - (days - 1) * 86400000);
    setFrom(start.toLocaleDateString('en-CA'));
    setTo(end.toLocaleDateString('en-CA'));
  };

  const s = data.summary;

  return (
    <div className="page">
      <div className="page-head row-between wrap">
        <div>
          <h1>ประวัติการขาย</h1>
          <div className="sub">บิลทั้งหมดจากหน้า POS · ดูใบเสร็จย้อนหลัง คืนเงิน และส่งออกเป็น CSV ได้</div>
        </div>
        <button
          className="btn"
          onClick={() => downloadCsv('/reports/sales/export', { from, to }, `sales-${from}_${to}.csv`)}
        >
          ⬇ ส่งออก CSV
        </button>
      </div>

      {s && (
        <div className="kpi-row" style={{ marginBottom: 16 }}>
          <Stat label="จำนวนบิล" value={s.bills} unit="บิล" icon="🧾" />
          <Stat label="ยอดขายรวม" value={baht(s.total)} icon="💰" />
          <Stat label="คืนเงิน" value={baht(s.refunded)} icon="↩" tone={Number(s.refunded) ? 'var(--brand)' : undefined} />
          <Stat label="ยอดสุทธิ" value={baht(Number(s.total) - Number(s.refunded))} icon="📈" />
        </div>
      )}

      <Card tight>
        <div className="row gap-2 wrap" style={{ marginBottom: 12 }}>
          <Field label="ตั้งแต่"><input className="input" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="ถึง"><input className="input" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          <Field label="ค้นหา">
            <input className="input" value={q} onChange={(e) => setQ(e.target.value)} placeholder="เลขที่บิล หรือชื่อลูกค้า" />
          </Field>
          <div className="grow" />
          <div className="chips" style={{ alignSelf: 'center' }}>
            <button className="chip" onClick={() => { setFrom(todayStr()); setTo(todayStr()); }}>วันนี้</button>
            <button className="chip" onClick={() => quickRange(7)}>7 วัน</button>
            <button className="chip" onClick={() => quickRange(30)}>30 วัน</button>
          </div>
        </div>

        <div className="chips" style={{ marginBottom: 12 }}>
          <button className={`chip ${!status ? 'active' : ''}`} onClick={() => setStatus('')}>ทุกสถานะ</button>
          {Object.entries(STATUS).map(([k, v]) => (
            <button key={k} className={`chip ${status === k ? 'active' : ''}`} onClick={() => setStatus(k)}>{v.label}</button>
          ))}
        </div>

        {loading ? <Loading rows={5} /> : data.data.length === 0 ? (
          <Empty icon="🧾" title="ไม่พบบิลในช่วงที่เลือก" hint="ลองขยายช่วงวันที่ หรือล้างตัวกรอง" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>เลขที่บิล</th>
                  <th>เวลา</th>
                  <th>ลูกค้า</th>
                  <th>ช่าง</th>
                  <th className="right">รายการ</th>
                  <th className="right">ส่วนลด</th>
                  <th className="right">ยอดสุทธิ</th>
                  <th>สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((sale) => {
                  const st = STATUS[sale.status] || { label: sale.status, cls: '' };
                  return (
                    <tr key={sale.id}>
                      <td className="bold mono">{sale.bill_no}</td>
                      <td className="tiny">
                        {dateOf(sale.sale_date)}<br />
                        <span className="muted">{timeOf(sale.paid_at || sale.created_at)}</span>
                      </td>
                      <td>
                        {sale.customer_name || <span className="muted">ไม่ระบุ</span>}
                        {sale.ticket_no && <div className="tiny muted">คิว {sale.ticket_no}</div>}
                      </td>
                      <td className="tiny">{sale.barber_name || '—'}</td>
                      <td className="right mono">{sale.item_count}</td>
                      <td className="right mono">
                        {Number(sale.discount_amount) + Number(sale.points_discount) > 0
                          ? `−${baht(Number(sale.discount_amount) + Number(sale.points_discount))}`
                          : '—'}
                      </td>
                      <td className="right mono bold">
                        {baht(sale.total)}
                        {Number(sale.refunded_amount) > 0 && (
                          <div className="tiny" style={{ color: 'var(--brand)' }}>คืน {baht(sale.refunded_amount)}</div>
                        )}
                      </td>
                      <td><span className={`badge ${st.cls}`}><i className="dot-i" />{st.label}</span></td>
                      <td>
                        <div className="actions">
                          <button className="btn sm" onClick={() => openDetail(sale)}>ใบเสร็จ</button>
                          {['paid', 'partial_refund'].includes(sale.status) && ['admin', 'staff'].includes(user.role) && (
                            <button className="btn sm danger" onClick={() => setRefundFor(sale)}>คืนเงิน</button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!detail}
        title={`ใบเสร็จ ${detail?.sale?.bill_no || ''}`}
        onClose={() => setDetail(null)}
        footer={(
          <>
            <button className="btn" onClick={() => setDetail(null)}>ปิด</button>
            <button className="btn dark" onClick={() => window.print()}>🖨 พิมพ์</button>
          </>
        )}
      >
        {detail && (
          <>
            <Receipt sale={detail.sale} shop={detail.shop} />
            {detail.sale.refunds?.length > 0 && (
              <div className="mt-4">
                <div className="bold small">ประวัติการคืนเงิน</div>
                {detail.sale.refunds.map((r) => (
                  <div key={r.id} className="small muted mt-1">
                    {dateTimeOf(r.created_at)} · {baht(r.amount)} · {METHOD_LABEL[r.method] || r.method}
                    {r.reason && ` · ${r.reason}`}
                    {r.actor_name && ` · โดย ${r.actor_name}`}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </Modal>

      <RefundModal
        sale={refundFor}
        onClose={() => setRefundFor(null)}
        onDone={() => { setRefundFor(null); load(); }}
        toast={toast}
      />
    </div>
  );
}

function RefundModal({ sale, onClose, onDone, toast }) {
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState('cash');
  const [reason, setReason] = useState('');
  const [restock, setRestock] = useState(true);
  const [busy, setBusy] = useState(false);

  const remaining = sale ? Number(sale.total) - Number(sale.refunded_amount) : 0;

  useEffect(() => {
    if (sale) {
      setAmount(String(Number(sale.total) - Number(sale.refunded_amount)));
      setMethod('cash'); setReason(''); setRestock(true);
    }
  }, [sale]);

  if (!sale) return null;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/pos/sales/${sale.id}/refund`, {
        amount: Number(amount), method, reason: reason || undefined, restock,
      });
      toast.success(r.message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`คืนเงิน · ${sale.bill_no}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button
            className="btn primary"
            onClick={submit}
            disabled={busy || !(Number(amount) > 0) || Number(amount) > remaining + 0.009}
          >
            {busy && <span className="spinner" />}ยืนยันคืนเงิน
          </button>
        </>
      )}
    >
      <div className="dl" style={{ marginBottom: 14 }}>
        <dt>ยอดบิล</dt><dd>{baht(sale.total)}</dd>
        <dt>คืนไปแล้ว</dt><dd>{baht(sale.refunded_amount)}</dd>
        <dt>คืนได้อีกไม่เกิน</dt><dd style={{ color: 'var(--brand)' }}>{baht(remaining)}</dd>
      </div>

      <Field label="จำนวนเงินที่คืน (บาท)">
        <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="คืนเป็น">
        <select className="select" value={method} onChange={(e) => setMethod(e.target.value)}>
          {Object.entries(METHOD_LABEL)
            .filter(([k]) => k !== 'points')
            .map(([k, v]) => <option key={k} value={k}>{v}</option>)}
        </select>
      </Field>
      <Field label="เหตุผล">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น สินค้าชำรุด" />
      </Field>
      <label className="row gap-2">
        <Switch checked={restock} onChange={setRestock} />
        <span className="small">คืนสินค้าเข้าสต็อก (เมื่อคืนเงินเต็มจำนวน)</span>
      </label>
    </Modal>
  );
}
