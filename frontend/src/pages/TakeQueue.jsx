import { useState, useEffect } from 'react';
import { useNavigate, useSearchParams, Link } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import {
  Card, Empty, Loading, Alert, ServiceThumb, baht, SERVICE_ICONS as ICONS,
} from '../components/ui.jsx';
import PaymentPanel from '../components/PaymentPanel.jsx';
import LineQrCard from '../components/LineQrCard.jsx';

export default function TakeQueue() {
  const toast = useToast();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const fromQr = params.get('src') === 'qr';

  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [board, setBoard] = useState(null);
  const [loading, setLoading] = useState(true);

  const [categoryFilter, setCategoryFilter] = useState('');
  const [serviceId, setServiceId] = useState(null);
  const [barberId, setBarberId] = useState('');
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [payConfig, setPayConfig] = useState(null);
  const [payment, setPayment] = useState(null);

  useEffect(() => {
    Promise.all([
      api.get('/services', { active_only: 'true' }),
      api.get('/services/categories'),
      api.get('/barbers'),
      api.get('/queue/current'),
      api.get('/payments/config').catch(() => null),
      api.get('/payments/current').catch(() => ({ payment: null })),
    ])
      .then(([s, c, b, q, pc, cur]) => {
        setServices(s.data);
        setCategories(c.data);
        setBarbers(b.data);
        setBoard(q);
        setPayConfig(pc);
        if (cur?.payment) setPayment(cur.payment);   // กลับมาทำรายการที่ค้างจ่ายต่อ
      })
      .catch((err) => toast.error(err.message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = async () => {
    if (!serviceId) { setError('กรุณาเลือกบริการที่ต้องการ'); return; }
    setError('');
    setBusy(true);
    const body = {
      service_id: serviceId,
      source: fromQr ? 'qr_code' : 'online',
      ...(barberId ? { barber_id: Number(barberId) } : {}),
    };
    try {
      // ร้านเปิดระบบจ่ายก่อน -> สร้าง QR PromptPay แล้วรอสลิป
      if (payConfig?.required) {
        const d = await api.post('/payments', body);
        if (d.payment) { setPayment(d.payment); return; }
        setResult(d);                       // บริการฟรี ได้บัตรคิวทันที
        toast.ok(`รับบัตรคิว ${d.ticket.ticket_no} เรียบร้อยแล้ว`);
        return;
      }
      const d = await api.post('/queue', body);
      setResult(d);
      toast.ok(`รับบัตรคิว ${d.ticket.ticket_no} เรียบร้อยแล้ว`);
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Loading rows={5} /></div>;

  if (payment && !result) {
    return (
      <div className="page">
        <div className="page-head">
          <h1>ชำระเงิน</h1>
          <div className="sub">ชำระเงินผ่าน QR PromptPay แล้วอัปโหลดสลิป ระบบจะออกบัตรคิวให้อัตโนมัติ</div>
        </div>
        <PaymentPanel
          payment={payment}
          testMode={payConfig?.test_mode}
          onPaid={(d) => {
            setPayment(null);
            if (d.ticket) {
              setResult(d);
              toast.ok(d.message || `ชำระเงินสำเร็จ ได้รับบัตรคิว ${d.ticket.ticket_no}`);
            } else {
              toast.ok('พนักงานยืนยันการชำระเงินแล้ว');
              navigate('/app/my-queue');
            }
          }}
          onCancel={async () => {
            try { await api.post(`/payments/${payment.id}/cancel`); } catch { /* หมดอายุ/ยกเลิกไปแล้ว */ }
            setPayment(null);
          }}
        />
      </div>
    );
  }

  if (result) {
    return (
      <div className="page">
        <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr)', maxWidth: 520, margin: '0 auto' }}>
          {result.payment?.status === 'paid' && (
            <Alert kind="ok">
              ชำระเงินสำเร็จ {baht(result.payment.amount)} · เลขอ้างอิง {result.payment.ref_code}
            </Alert>
          )}
          <div className="ticket-hero center" style={{ alignItems: 'center' }}>
            <div>
              <div className="eyebrow">รับบัตรคิวสำเร็จ</div>
              <div className="number">{result.ticket.ticket_no}</div>
              <div className="meta">{result.ticket.service_name} · {result.ticket.duration_min} นาที · {baht(result.ticket.price)}</div>
              <div className="meta mt-2">
                ลำดับที่ {result.ticket.position} · รอโดยประมาณ {result.ticket.estimated_wait_min} นาที
              </div>
            </div>
          </div>

          <Card className="mt-3">
            <div className="center">
              <img src={result.qr_code} alt="QR ติดตามคิว" width={200} height={200} />
              <p className="small muted mt-2">บันทึก QR นี้ไว้เพื่อติดตามคิวของคุณ แม้ไม่ได้เข้าสู่ระบบ</p>
              <div className="row gap-2 mt-3" style={{ justifyContent: 'center' }}>
                <Link to="/app/my-queue" className="btn primary">ดูสถานะคิวของฉัน</Link>
                <button className="btn" onClick={() => navigator.clipboard?.writeText(result.track_url)}>
                  คัดลอกลิงก์ติดตาม
                </button>
              </div>
            </div>
          </Card>

          <LineQrCard
            ticketId={result.ticket.id}
            className="mt-3"
            title="รับแจ้งเตือนเมื่อถึงคิวของคุณ"
          />
        </div>
      </div>
    );
  }

  const filtered = services.filter((s) => !categoryFilter || String(s.category_id) === categoryFilter);
  const selected = services.find((s) => s.id === serviceId);

  return (
    <div className="page">
      <div className="page-head">
        <h1>รับบัตรคิว</h1>
        <div className="sub">
          เลือกบริการที่ต้องการ ระบบจะออกหมายเลขคิวให้อัตโนมัติ
          {board && ` · ขณะนี้มีคิวรออยู่ ${board.waiting_count} คิว`}
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {fromQr && <Alert kind="info">คุณเข้าสู่หน้านี้ผ่านการสแกน QR Code หน้าร้าน</Alert>}

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) minmax(0, 320px)' }}>
        <div>
          <div className="row gap-1 wrap" style={{ marginBottom: 14 }}>
            <button className={`btn sm ${categoryFilter === '' ? 'dark' : 'ghost'}`}
              onClick={() => setCategoryFilter('')}>ทั้งหมด</button>
            {categories.map((c) => (
              <button key={c.id} className={`btn sm ${categoryFilter === String(c.id) ? 'dark' : 'ghost'}`}
                onClick={() => setCategoryFilter(String(c.id))}>
                {ICONS[c.name] || '•'} {c.name}
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Card><Empty icon="✂" title="ยังไม่มีบริการในประเภทนี้" /></Card>
          ) : (
            <div className="grid grid-auto">
              {filtered.map((s) => (
                <div key={s.id}
                  className={`svc-card selectable ${serviceId === s.id ? 'selected' : ''}`}
                  onClick={() => setServiceId(s.id)}
                  role="button" tabIndex={0}
                  onKeyDown={(e) => e.key === 'Enter' && setServiceId(s.id)}>
                  <ServiceThumb service={s}>
                    {s.category_name && <span className="svc-tag">{s.category_name}</span>}
                  </ServiceThumb>
                  <div className="body">
                    <div className="bold">{s.name}</div>
                    <div className="small muted">{s.description || s.category_name}</div>
                    <div className="row-between mt-2">
                      <div className="price">{baht(s.price)}</div>
                      <span className="badge">{s.duration_min} นาที</span>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        <div className="col gap-3">
          <Card title="สรุปการรับคิว">
            <div className="field">
              <label>บริการที่เลือก</label>
              {selected ? (
                <div className="card" style={{ background: 'var(--ink-50)' }}>
                  <div className="card-body tight">
                    <div className="bold">{selected.name}</div>
                    <div className="small muted">{selected.duration_min} นาที · {baht(selected.price)}</div>
                  </div>
                </div>
              ) : <div className="small muted">ยังไม่ได้เลือกบริการ</div>}
            </div>

            <div className="field">
              <label>เลือกช่าง (ไม่บังคับ)</label>
              <select className="select" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                <option value="">— ช่างคนไหนว่างก่อนก็ได้ —</option>
                {barbers.filter((b) => b.status !== 'off').map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.full_name} ({b.specialty || b.code}) — ★ {Number(b.rating).toFixed(1)}
                  </option>
                ))}
              </select>
              <span className="hint">การเลือกช่างเฉพาะเจาะจงอาจทำให้รอนานขึ้น</span>
            </div>

            <button className="btn primary block lg" onClick={submit} disabled={busy || !serviceId}>
              {busy && <span className="spinner" />}
              {payConfig?.required && selected && Number(selected.price) > 0
                ? `ชำระเงิน ${baht(selected.price)} และรับบัตรคิว`
                : 'ยืนยันรับบัตรคิว'}
            </button>
            {payConfig?.required && (
              <div className="tiny muted center mt-1">ชำระผ่าน QR PromptPay ได้ทุกธนาคาร · ได้บัตรคิวทันทีหลังตรวจสลิป</div>
            )}
          </Card>

          {board && (
            <Card title="สถานะหน้าร้านตอนนี้" tight>
              <div className="queue-row">
                <div className="grow small muted">กำลังให้บริการ</div>
                <div className="bold">{board.now_serving[0]?.ticket_no || '—'}</div>
              </div>
              <div className="queue-row">
                <div className="grow small muted">คิวที่รออยู่</div>
                <div className="bold">{board.waiting_count} คิว</div>
              </div>
              <div className="queue-row">
                <div className="grow small muted">ให้บริการไปแล้ววันนี้</div>
                <div className="bold">{board.done_count} คิว</div>
              </div>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
