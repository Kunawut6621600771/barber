import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Empty, Loading, Stat, ConfirmModal, baht, timeOf } from '../components/ui.jsx';

const STATUS = {
  pending:   { label: 'รอชำระ',      cls: 'warn' },
  paid:      { label: 'ชำระแล้ว',    cls: 'ok' },
  expired:   { label: 'หมดเวลา',     cls: '' },
  cancelled: { label: 'ยกเลิก',      cls: 'danger' },
  failed:    { label: 'ไม่สำเร็จ',    cls: 'danger' },
};
const METHOD = { promptpay: 'PromptPay (ตรวจสลิป)', cash: 'เงินสด', manual: 'พนักงานยืนยัน' };

const todayStr = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

export default function Payments() {
  const toast = useToast();
  const { user } = useAuth();
  const canApprove = ['admin', 'staff'].includes(user.role);

  const [date, setDate] = useState(todayStr());
  const [status, setStatus] = useState('');
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [target, setTarget] = useState(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/payments', { date, status }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [date, status]);

  useEffect(() => { load(); }, [load]);
  useRealtime({ 'payment:update': load, 'queue:update': load });

  const approve = async () => {
    setBusy(true);
    try {
      const d = await api.post(`/payments/${target.p.id}/approve`, { method: target.method });
      toast.ok(d.message);
      setTarget(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Loading rows={5} /></div>;
  const s = data?.summary || {};

  return (
    <div className="page">
      <div className="page-head row-between wrap gap-2">
        <div>
          <h1>การชำระเงิน</h1>
          <div className="sub">รายการชำระเงินผ่าน QR PromptPay และผลการตรวจสลิป</div>
        </div>
        <div className="row gap-2">
          <select className="select" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">ทุกสถานะ</option>
            {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
          </select>
          <input className="input" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
      </div>

      <div className="grid grid-4">
        <Stat label="ยอดรับชำระ" value={baht(s.revenue)} icon="฿" />
        <Stat label="ชำระแล้ว" value={s.paid ?? 0} unit="รายการ" icon="✓" />
        <Stat label="รอชำระ" value={s.pending ?? 0} unit="รายการ" icon="⏳" />
        <Stat label="ต้องตรวจสอบ" value={s.needs_attention ?? 0} unit="รายการ" icon="⚠"
          tone={s.needs_attention ? 'var(--brand)' : undefined} />
      </div>

      <Card className="mt-4" tight>
        {!data?.data?.length ? (
          <Empty icon="฿" title="ยังไม่มีรายการชำระเงิน" hint="เมื่อลูกค้าเลือกบริการและสร้าง QR รายการจะแสดงที่นี่" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>เวลา</th><th>เลขอ้างอิง</th><th>ลูกค้า</th><th>บริการ</th><th>ยอด</th>
                  <th>สถานะ</th><th>คิว</th><th>หมายเหตุ</th><th />
                </tr>
              </thead>
              <tbody>
                {data.data.map((p) => {
                  const st = STATUS[p.status] || { label: p.status, cls: '' };
                  const needsTicket = p.status === 'paid' && !p.ticket_id;
                  return (
                    <tr key={p.id}>
                      <td className="small">{timeOf(p.created_at)}</td>
                      <td className="mono small bold">{p.ref_code}</td>
                      <td className="small">{p.customer_name}<div className="tiny muted">{p.customer_phone || ''}</div></td>
                      <td className="small">{p.service_name}</td>
                      <td className="small bold">{baht(p.amount)}</td>
                      <td>
                        <span className={`badge ${st.cls}`}><i className="dot-i" />{st.label}</span>
                        {p.status === 'paid' && <div className="tiny muted mt-1">{METHOD[p.method] || p.method}</div>}
                      </td>
                      <td className="mono small bold">{p.ticket_no || '—'}</td>
                      <td className="tiny muted" style={{ maxWidth: 220 }}>
                        {p.slip_trans_ref && <div>Ref: {p.slip_trans_ref}</div>}
                        {p.fail_reason && <div style={{ color: needsTicket ? 'var(--brand-dark)' : undefined }}>{p.fail_reason}</div>}
                      </td>
                      <td>
                        {canApprove && ['pending', 'expired', 'failed'].includes(p.status) && (
                          <div className="row gap-1">
                            <button className="btn sm" onClick={() => setTarget({ p, method: 'cash' })}>รับเงินสด</button>
                            <button className="btn sm dark" onClick={() => setTarget({ p, method: 'manual' })}>ยืนยันโอน</button>
                          </div>
                        )}
                        {canApprove && needsTicket && (
                          <button className="btn sm primary" onClick={() => setTarget({ p, method: 'manual' })}>ออกบัตรคิว</button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <ConfirmModal
        open={!!target}
        title="ยืนยันการชำระเงิน"
        message={target && (target.p.status === 'paid'
          ? `ออกบัตรคิวให้รายการ ${target.p.ref_code} (${target.p.customer_name})?`
          : `ยืนยันว่าได้รับเงิน ${baht(target.p.amount)} จาก ${target.p.customer_name} ${target.method === 'cash' ? 'เป็นเงินสด' : 'ผ่านการโอน (ตรวจสอบยอดในบัญชีแล้ว)'} และออกบัตรคิวให้?`)}
        confirmText="ยืนยัน" busy={busy}
        onClose={() => setTarget(null)} onConfirm={approve}
      />
    </div>
  );
}
