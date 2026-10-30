import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Card, Modal, Field, Empty, Loading, Stat, Alert, baht, dateTimeOf, timeOf,
} from '../components/ui.jsx';

export default function Shifts() {
  const toast = useToast();

  const [current, setCurrent] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [openModal, setOpenModal] = useState(false);
  const [closeModal, setCloseModal] = useState(false);
  const [cashModal, setCashModal] = useState(null);     // 'in' | 'out'
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const [cur, list] = await Promise.all([api.get('/shifts/current'), api.get('/shifts')]);
      setCurrent(cur.shift);
      setHistory(list.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const showDetail = async (shift) => {
    try {
      setDetail(await api.get(`/shifts/${shift.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="page"><Loading rows={5} /></div>;

  return (
    <div className="page">
      <div className="page-head row-between wrap">
        <div>
          <h1>กะและเงินสด</h1>
          <div className="sub">เปิดกะตอนเริ่มวัน ปิดกะตอนเลิกงาน ระบบจะเทียบเงินที่นับได้กับยอดที่ควรมีให้</div>
        </div>
        {current
          ? <button className="btn primary" onClick={() => setCloseModal(true)}>ปิดกะ</button>
          : <button className="btn primary" onClick={() => setOpenModal(true)}>เปิดกะ</button>}
      </div>

      {current ? (
        <>
          <div className="kpi-row" style={{ marginBottom: 16 }}>
            <Stat label="เงินสดที่ควรมีในลิ้นชัก" value={baht(current.expected_cash)} icon="💵" tone="var(--brand)" />
            <Stat label="เงินทอนตั้งต้น" value={baht(current.opening_float)} icon="🪙" />
            <Stat label="บิลในกะนี้" value={current.bills} unit="บิล" icon="🧾" />
            <Stat label="ยอดขายในกะ" value={baht(current.sales_total)} icon="📈" />
          </div>

          <div className="grid grid-2">
            <Card title="แยกตามวิธีชำระเงิน" subtitle={`เปิดกะเมื่อ ${dateTimeOf(current.opened_at)} โดย ${current.opened_by_name || '—'}`}>
              <div className="dl">
                <dt>💵 เงินสด</dt><dd>{baht(current.cash_total)}</dd>
                <dt>📱 QR พร้อมเพย์</dt><dd>{baht(current.qr_total)}</dd>
                <dt>💳 บัตร</dt><dd>{baht(current.card_total)}</dd>
                <dt>🏦 โอน</dt><dd>{baht(current.transfer_total)}</dd>
                <dt>↩ เงินทอนที่จ่ายออก</dt><dd>−{baht(current.change_total)}</dd>
                <dt>➕ นำเงินเข้าลิ้นชัก</dt><dd>{baht(current.cash_in)}</dd>
                <dt>➖ เบิกเงินออก</dt><dd>−{baht(current.cash_out)}</dd>
              </div>
            </Card>

            <Card title="เงินเข้า-ออกลิ้นชัก" subtitle="บันทึกเงินที่ไม่ได้มาจากการขาย เช่น เติมเงินทอน หรือเบิกไปซื้อของ">
              <div className="row gap-2">
                <button className="btn block" onClick={() => setCashModal('in')}>➕ นำเงินเข้า</button>
                <button className="btn block" onClick={() => setCashModal('out')}>➖ เบิกเงินออก</button>
              </div>
              <Alert kind="info">
                เงินสดที่ควรมี = เงินทอนตั้งต้น + รับเงินสด − เงินทอนที่จ่าย + เงินเข้า − เงินออก − คืนเงินสด
              </Alert>
            </Card>
          </div>
        </>
      ) : (
        <Card>
          <Empty
            icon="🔒"
            title="ยังไม่ได้เปิดกะ"
            hint="เปิดกะก่อนเริ่มขาย เพื่อให้บิลทุกใบถูกนับเข้ากะและสรุปเงินสดตอนปิดร้านได้ถูกต้อง"
          />
          <button className="btn primary block" onClick={() => setOpenModal(true)}>เปิดกะตอนนี้</button>
        </Card>
      )}

      <Card title="ประวัติกะ" className="mt-4" tight>
        {history.length === 0 ? (
          <Empty icon="📋" title="ยังไม่มีประวัติกะ" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>เปิด</th><th>ปิด</th><th>ผู้เปิด / ผู้ปิด</th>
                  <th className="right">บิล</th><th className="right">ยอดขาย</th>
                  <th className="right">ควรมี</th><th className="right">นับได้</th>
                  <th className="right">ขาด/เกิน</th><th />
                </tr>
              </thead>
              <tbody>
                {history.map((sh) => {
                  const diff = sh.difference === null ? null : Number(sh.difference);
                  return (
                    <tr key={sh.id}>
                      <td className="tiny">{dateTimeOf(sh.opened_at)}</td>
                      <td className="tiny">{sh.closed_at ? dateTimeOf(sh.closed_at) : <span className="badge warn"><i className="dot-i" />เปิดอยู่</span>}</td>
                      <td className="tiny">{sh.opened_by_name || '—'}{sh.closed_by_name ? ` / ${sh.closed_by_name}` : ''}</td>
                      <td className="right mono">{sh.bills}</td>
                      <td className="right mono">{baht(sh.sales_total)}</td>
                      <td className="right mono">{sh.expected_cash === null ? '—' : baht(sh.expected_cash)}</td>
                      <td className="right mono">{sh.counted_cash === null ? '—' : baht(sh.counted_cash)}</td>
                      <td className="right mono bold">
                        {diff === null ? '—' : (
                          <span style={{ color: diff === 0 ? 'var(--ok)' : 'var(--brand)' }}>
                            {diff > 0 ? '+' : ''}{baht(diff)}
                          </span>
                        )}
                      </td>
                      <td><button className="btn sm" onClick={() => showDetail(sh)}>ดู</button></td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <OpenModal open={openModal} onClose={() => setOpenModal(false)} onDone={() => { setOpenModal(false); load(); }} toast={toast} />
      <CloseModal open={closeModal} shift={current} onClose={() => setCloseModal(false)} onDone={() => { setCloseModal(false); load(); }} toast={toast} />
      <CashModal direction={cashModal} onClose={() => setCashModal(null)} onDone={() => { setCashModal(null); load(); }} toast={toast} />

      <Modal
        open={!!detail}
        wide
        title={`สรุปกะ #${detail?.shift?.id || ''}`}
        onClose={() => setDetail(null)}
        footer={<button className="btn dark" onClick={() => setDetail(null)}>ปิด</button>}
      >
        {detail && (
          <>
            <div className="dl" style={{ marginBottom: 16 }}>
              <dt>เปิดกะ</dt><dd>{dateTimeOf(detail.shift.opened_at)} · {detail.shift.opened_by_name || '—'}</dd>
              <dt>ปิดกะ</dt><dd>{detail.shift.closed_at ? `${dateTimeOf(detail.shift.closed_at)} · ${detail.shift.closed_by_name || '—'}` : 'ยังเปิดอยู่'}</dd>
              <dt>เงินทอนตั้งต้น</dt><dd>{baht(detail.shift.opening_float)}</dd>
              <dt>ยอดขาย</dt><dd>{baht(detail.shift.sales_total)}</dd>
              <dt>เงินสดที่ควรมี</dt><dd>{detail.shift.expected_cash === null ? '—' : baht(detail.shift.expected_cash)}</dd>
              <dt>เงินที่นับได้</dt><dd>{detail.shift.counted_cash === null ? '—' : baht(detail.shift.counted_cash)}</dd>
            </div>
            {detail.shift.note && <Alert kind="info">{detail.shift.note}</Alert>}

            {detail.movements.length > 0 && (
              <>
                <div className="divider">เงินเข้า-ออกลิ้นชัก</div>
                {detail.movements.map((m) => (
                  <div key={m.id} className="row-between small" style={{ padding: '6px 0', borderBottom: '1px solid var(--border-soft)' }}>
                    <span>{timeOf(m.created_at)} · {m.reason}</span>
                    <span className="mono bold" style={{ color: m.direction === 'in' ? 'var(--ok)' : 'var(--brand)' }}>
                      {m.direction === 'in' ? '+' : '−'}{baht(m.amount)}
                    </span>
                  </div>
                ))}
              </>
            )}

            <div className="divider">บิลในกะ ({detail.sales.length})</div>
            {detail.sales.length === 0 ? <Empty icon="🧾" title="ไม่มีบิลในกะนี้" /> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>บิล</th><th>เวลา</th><th>ลูกค้า</th><th className="right">ยอด</th></tr></thead>
                  <tbody>
                    {detail.sales.map((sl) => (
                      <tr key={sl.id}>
                        <td className="mono">{sl.bill_no}</td>
                        <td className="tiny">{timeOf(sl.paid_at || sl.created_at)}</td>
                        <td className="tiny">{sl.customer_name || '—'}</td>
                        <td className="right mono">{baht(sl.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

/* ----------------------------- โมดอล ----------------------------- */

function OpenModal({ open, onClose, onDone, toast }) {
  const [float, setFloat] = useState('1000');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await api.post('/shifts/open', { opening_float: Number(float) || 0, note: note || undefined })).message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="เปิดกะ"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}เปิดกะ
          </button>
        </>
      )}
    >
      <Field label="เงินทอนตั้งต้นในลิ้นชัก (บาท)" hint="นับเงินในลิ้นชักก่อนเริ่มขาย แล้วกรอกตามจริง">
        <input className="input" type="number" min="0" value={float} onChange={(e) => setFloat(e.target.value)} />
      </Field>
      <Field label="หมายเหตุ">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น กะเช้า" />
      </Field>
    </Modal>
  );
}

function CloseModal({ open, shift, onClose, onDone, toast }) {
  const [counted, setCounted] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (open && shift) { setCounted(String(shift.expected_cash ?? '')); setNote(''); }
  }, [open, shift]);

  if (!shift) return null;

  const diff = Number(counted || 0) - Number(shift.expected_cash || 0);

  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await api.post('/shifts/close', { counted_cash: Number(counted) || 0, note: note || undefined })).message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="ปิดกะ"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy || counted === ''}>
            {busy && <span className="spinner" />}ปิดกะ
          </button>
        </>
      )}
    >
      <div className="dl" style={{ marginBottom: 14 }}>
        <dt>บิลในกะ</dt><dd>{shift.bills} บิล</dd>
        <dt>ยอดขาย</dt><dd>{baht(shift.sales_total)}</dd>
        <dt>เงินสดที่ควรมี</dt><dd style={{ color: 'var(--brand)' }}>{baht(shift.expected_cash)}</dd>
      </div>

      <Field label="เงินสดที่นับได้จริง (บาท)" hint="นับเงินในลิ้นชักทั้งหมดแล้วกรอกตามจริง">
        <input className="input" type="number" min="0" step="0.01" value={counted} onChange={(e) => setCounted(e.target.value)} />
      </Field>

      {counted !== '' && (
        <Alert kind={Math.abs(diff) < 0.01 ? 'ok' : 'error'}>
          {Math.abs(diff) < 0.01
            ? 'ยอดตรงพอดี'
            : diff > 0 ? `เงินเกิน ${baht(diff)}` : `เงินขาด ${baht(Math.abs(diff))}`}
        </Alert>
      )}

      <Field label="หมายเหตุ">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ลูกค้าให้ทิป / ทอนผิด" />
      </Field>
    </Modal>
  );
}

function CashModal({ direction, onClose, onDone, toast }) {
  const [amount, setAmount] = useState('');
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (direction) { setAmount(''); setReason(''); } }, [direction]);
  if (!direction) return null;

  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await api.post('/shifts/cash', { direction, amount: Number(amount), reason })).message);
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
      title={direction === 'in' ? 'นำเงินเข้าลิ้นชัก' : 'เบิกเงินออกจากลิ้นชัก'}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy || !(Number(amount) > 0) || !reason.trim()}>
            {busy && <span className="spinner" />}บันทึก
          </button>
        </>
      )}
    >
      <Field label="จำนวนเงิน (บาท)">
        <input className="input" type="number" min="0" step="0.01" value={amount} onChange={(e) => setAmount(e.target.value)} />
      </Field>
      <Field label="เหตุผล">
        <input
          className="input"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder={direction === 'in' ? 'เช่น เติมเงินทอน' : 'เช่น ซื้อของเข้าร้าน'}
        />
      </Field>
    </Modal>
  );
}
