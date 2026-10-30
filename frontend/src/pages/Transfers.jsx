import { useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useRealtime } from '../api/realtime.js';
import { Card, Stat, Avatar, Empty, Loading, Modal, baht, dateTimeOf } from '../components/ui.jsx';

const STATUS = {
  paid:      { label: 'ชำระแล้ว',   cls: 'ok' },
  pending:   { label: 'รอชำระ',     cls: 'warn' },
  failed:    { label: 'ไม่ผ่าน',     cls: 'danger' },
  expired:   { label: 'หมดเวลา',    cls: '' },
  cancelled: { label: 'ยกเลิก',     cls: '' },
};

const METHOD = { promptpay: 'ตรวจสลิปอัตโนมัติ', manual: 'พนักงานยืนยัน', cash: 'เงินสด' };

const shopDate = (plusDays = 0) =>
  new Date(Date.now() + plusDays * 86_400_000).toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });

/** ประวัติการโอนของลูกค้า + เปิดดูรูปสลิป */
export default function Transfers() {
  const toast = useToast();
  const [from, setFrom] = useState(shopDate(-6));
  const [to, setTo] = useState(shopDate());
  const [status, setStatus] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [slips, setSlips] = useState(null);     // { payment, slips } ของรายการที่เปิดดู
  const [slipIdx, setSlipIdx] = useState(0);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/payments/history', { from, to, status, search, page, limit: 15 }));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [from, to, status, search, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 320 : 0);
    return () => clearTimeout(t);
  }, [load, search]);
  useRealtime({ 'payment:update': load });

  const openSlips = async (p) => {
    try {
      const d = await api.get(`/payments/${p.id}/slips`);
      setSlipIdx(0);
      setSlips({ ...d, row: p });
    } catch (err) { toast.error(err.message); }
  };

  const rows = data?.data || [];
  const pg = data?.pagination || { page: 1, pages: 1, total: 0 };
  const current = slips?.slips?.[slipIdx];
  const filter = (fn) => (v) => { fn(v); setPage(1); };

  return (
    <div className="page">
      <div className="page-head">
        <h1>ประวัติการโอน</h1>
        <div className="sub">รายการโอนเงินผ่าน QR PromptPay ของลูกค้า กดที่รายการเพื่อดูสลิป</div>
      </div>

      <div className="grid grid-4">
        <Stat label="รายการในช่วงนี้" value={pg.total} unit="รายการ" icon="🧾" />
        <Stat label="ยอดที่ชำระแล้ว" value={baht(data?.summary?.paid_amount)} icon="฿" />
      </div>

      <Card className="mt-4" tight>
        <div className="row-between wrap gap-2" style={{ padding: '4px 4px 12px' }}>
          <div className="row gap-1 wrap">
            <input className="input" type="date" style={{ height: 32 }} value={from} max={to}
              onChange={(e) => filter(setFrom)(e.target.value)} aria-label="ตั้งแต่วันที่" />
            <span className="small muted" style={{ alignSelf: 'center' }}>ถึง</span>
            <input className="input" type="date" style={{ height: 32 }} value={to} min={from}
              onChange={(e) => filter(setTo)(e.target.value)} aria-label="ถึงวันที่" />
            <select className="select" style={{ height: 32 }} value={status}
              onChange={(e) => filter(setStatus)(e.target.value)} aria-label="สถานะ">
              <option value="">ทุกสถานะ</option>
              {Object.entries(STATUS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
            </select>
          </div>
          <input className="input" style={{ maxWidth: 260, height: 32 }}
            placeholder="ค้นหาชื่อลูกค้า ชื่อ LINE เบอร์ หรือเลขอ้างอิง"
            value={search} onChange={(e) => filter(setSearch)(e.target.value)} />
        </div>

        {loading ? <Loading rows={6} /> : rows.length === 0 ? (
          <Empty icon="🧾" title="ไม่มีรายการโอนในช่วงนี้" hint="ลองเปลี่ยนช่วงวันที่หรือคำค้นหา" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>วันเวลา</th><th>ลูกค้า</th><th>บริการ</th><th className="right">ยอด</th>
                  <th>สถานะ</th><th>คิว</th><th className="right">สลิป</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => {
                  const st = STATUS[p.status] || { label: p.status, cls: '' };
                  return (
                    <tr key={p.id} onClick={() => openSlips(p)} style={{ cursor: 'pointer' }}>
                      <td className="small">
                        {dateTimeOf(p.created_at)}
                        <div className="tiny muted mono">{p.ref_code}</div>
                      </td>
                      <td>
                        <div className="row gap-2">
                          <Avatar name={p.customer_name} size="sm" src={p.line_picture_url} />
                          <div>
                            <div className="bold small">{p.customer_name}</div>
                            {p.line_display_name && <div className="tiny line-name">LINE: {p.line_display_name}</div>}
                            {p.customer_phone && <div className="tiny muted">{p.customer_phone}</div>}
                          </div>
                        </div>
                      </td>
                      <td className="small">{p.service_name}</td>
                      <td className="right small bold">{baht(p.amount)}</td>
                      <td>
                        <span className={`badge ${st.cls}`}><i className="dot-i" />{st.label}</span>
                        {p.status === 'paid' && <div className="tiny muted mt-1">{METHOD[p.method] || p.method}</div>}
                        {p.status !== 'paid' && p.fail_reason && (
                          <div className="tiny muted mt-1" style={{ maxWidth: 200 }}>{p.fail_reason}</div>
                        )}
                      </td>
                      <td className="mono small bold">{p.ticket_no || '—'}</td>
                      <td className="right">
                        {p.slip_count > 0
                          ? <button className="btn sm" onClick={(e) => { e.stopPropagation(); openSlips(p); }}>ดูสลิป ({p.slip_count})</button>
                          : <span className="tiny muted">ไม่มีสลิป</span>}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {pg.pages > 1 && (
          <div className="row-between" style={{ padding: '12px 4px 4px' }}>
            <span className="small muted">หน้า {pg.page} จาก {pg.pages} · ทั้งหมด {pg.total} รายการ</span>
            <div className="row gap-1">
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((n) => n - 1)}>ก่อนหน้า</button>
              <button className="btn sm" disabled={page >= pg.pages} onClick={() => setPage((n) => n + 1)}>ถัดไป</button>
            </div>
          </div>
        )}
      </Card>

      {/* --------------------------- สลิป --------------------------- */}
      <Modal open={!!slips} title={slips ? `สลิป ${slips.row.ref_code}` : ''} onClose={() => setSlips(null)}
        footer={<button className="btn dark" onClick={() => setSlips(null)}>ปิด</button>}>
        {slips && (
          <>
            <div className="small" style={{ marginBottom: 12 }}>
              <div><b>{slips.row.customer_name}</b>
                {slips.row.line_display_name && <span className="line-name"> · LINE: {slips.row.line_display_name}</span>}
              </div>
              <div className="muted">
                {slips.row.service_name} · {baht(slips.row.amount)}
                {slips.row.slip_trans_ref && <> · เลขธุรกรรม <span className="mono">{slips.row.slip_trans_ref}</span></>}
              </div>
              {slips.row.approved_by_name && <div className="muted">ยืนยันโดย {slips.row.approved_by_name}</div>}
            </div>

            {!current ? (
              <Empty icon="🖼" title="ไม่มีรูปสลิป"
                hint={slips.row.method === 'promptpay' || slips.row.status !== 'paid'
                  ? 'รายการก่อนเปิดระบบเก็บสลิปจะไม่มีรูป' : 'รายการนี้พนักงานยืนยันเอง ลูกค้าไม่ได้แนบสลิป'} />
            ) : (
              <>
                <div className="row-between small" style={{ marginBottom: 8 }}>
                  <span className={`badge ${current.ok ? 'ok' : 'danger'}`}>
                    <i className="dot-i" />{current.ok ? 'ตรวจผ่าน' : 'ตรวจไม่ผ่าน'}
                  </span>
                  <span className="muted">ส่งเมื่อ {dateTimeOf(current.created_at)}</span>
                </div>
                {!current.ok && current.reason && <div className="tiny muted" style={{ marginBottom: 8 }}>{current.reason}</div>}
                <img className="slip-img" src={current.image} alt={`สลิป ${slips.row.ref_code}`} />
                <div className="center mt-1">
                  <a className="small" href={current.image} download={`slip-${slips.row.ref_code}-${current.id}`}>ดาวน์โหลดรูปสลิป</a>
                </div>
                {slips.slips.length > 1 && (
                  <div className="row-between mt-2">
                    <button className="btn sm" disabled={slipIdx === 0} onClick={() => setSlipIdx((i) => i - 1)}>ใหม่กว่า</button>
                    <span className="small muted">ใบที่ {slipIdx + 1} จาก {slips.slips.length}</span>
                    <button className="btn sm" disabled={slipIdx >= slips.slips.length - 1}
                      onClick={() => setSlipIdx((i) => i + 1)}>เก่ากว่า</button>
                  </div>
                )}
              </>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}
