import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, StatusBadge, Avatar, Empty, Loading, Modal, ConfirmModal, Field,
  baht, timeOf, sinceMinutes, SOURCE_LABEL,
} from '../components/ui.jsx';

const TABS = [
  { key: 'active', label: 'กำลังดำเนินการ' },
  { key: 'waiting', label: 'รอคิว' },
  { key: 'done', label: 'เสร็จสิ้น' },
  { key: 'all', label: 'ทั้งหมด' },
];

export default function QueueManage() {
  const toast = useToast();
  const { user } = useAuth();

  const [tickets, setTickets] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [services, setServices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState('active');
  const [searchParams] = useSearchParams();
  const q = searchParams.get('q') || '';
  const [selectedId, setSelectedId] = useState(null);
  const [busy, setBusy] = useState(false);

  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState(null);
  const [cancelReason, setCancelReason] = useState('');

  const load = useCallback(async () => {
    try {
      const [q, b, s] = await Promise.all([
        api.get('/queue'),
        api.get('/barbers'),
        api.get('/services', { active_only: 'true' }),
      ]);
      setTickets(q.data);
      setBarbers(b.data);
      setServices(s.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);
  useRealtime({ 'queue:update': load, 'queue:called': load, 'barber:update': load });

  const act = async (path, body, successFallback) => {
    setBusy(true);
    try {
      const d = await api.post(path, body ?? {});
      toast.ok(d.message || successFallback);
      await load();
      return d;
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setBusy(false);
    }
  };

  const filtered = useMemo(() => {
    // ค้นจากช่องค้นหาด้านบน (?q=) ด้วยเลขคิว ชื่อ หรือเบอร์โทร -> ค้นทุกสถานะ
    const kw = q.trim().toLowerCase();
    if (kw) {
      return tickets.filter((t) => [t.ticket_no, t.customer_name, t.customer_phone]
        .some((v) => String(v || '').toLowerCase().includes(kw)));
    }
    if (tab === 'active') return tickets.filter((t) => ['called', 'serving'].includes(t.status));
    if (tab === 'waiting') return tickets.filter((t) => t.status === 'waiting');
    if (tab === 'done') return tickets.filter((t) => ['done', 'cancelled', 'no_show'].includes(t.status));
    return tickets;
  }, [tickets, tab, q]);

  const counts = useMemo(() => ({
    active: tickets.filter((t) => ['called', 'serving'].includes(t.status)).length,
    waiting: tickets.filter((t) => t.status === 'waiting').length,
    done: tickets.filter((t) => ['done', 'cancelled', 'no_show'].includes(t.status)).length,
    all: tickets.length,
  }), [tickets]);

  // คิวที่โฟกัสอยู่ทางซ้าย: ที่เลือกไว้ > กำลังให้บริการ > เรียกแล้ว > คิวถัดไป
  const focus = useMemo(() => {
    if (selectedId) {
      const found = tickets.find((t) => t.id === selectedId);
      if (found) return found;
    }
    return tickets.find((t) => t.status === 'serving')
      || tickets.find((t) => t.status === 'called')
      || tickets.filter((t) => t.status === 'waiting').sort((a, b) => a.position - b.position)[0]
      || null;
  }, [tickets, selectedId]);

  if (loading) return <div className="page"><Loading rows={7} /></div>;

  return (
    <div className="page">
      <div className="row-between page-head">
        <div>
          <h1>จัดการคิว</h1>
          <div className="sub">รอ {counts.waiting} คิว · กำลังดำเนินการ {counts.active} คิว · เสร็จสิ้นแล้ว {counts.done} คิว</div>
        </div>
        <div className="row gap-2 wrap">
          <button className="btn" onClick={() => act('/queue/reorder', {}, 'จัดลำดับคิวใหม่แล้ว')} disabled={busy}>
            ↻ จัดลำดับอัตโนมัติ
          </button>
          <button className="btn" onClick={() => setIssueOpen(true)}>＋ ออกบัตรคิว</button>
          <button className="btn primary" disabled={busy || counts.waiting === 0}
            onClick={() => act('/queue/call', { barber_id: user.barber_id ?? undefined }, 'เรียกคิวแล้ว')}>
            {busy && <span className="spinner" />}เรียกคิวถัดไป
          </button>
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 320px) minmax(0, 1fr)' }}>
        {/* ------------------------ คิวที่โฟกัส ----------------------- */}
        <div className="col gap-3">
          {focus ? (
            <div className="ticket-hero">
              <div>
                <div className="eyebrow">
                  {focus.status === 'serving' ? 'กำลังให้บริการ'
                    : focus.status === 'called' ? 'เรียกแล้ว — รอลูกค้า'
                      : 'คิวถัดไป'}
                </div>
                <div className="number">{focus.ticket_no}</div>
                <div className="meta">
                  {focus.customer_name}
                  {focus.customer_phone && ` · ${focus.customer_phone}`}
                </div>
                <div className="meta mt-1">
                  {focus.service_name} · {focus.duration_min} นาที · {baht(focus.price)}
                </div>
                <div className="meta mt-1">
                  ช่าง: {focus.barber_name || 'ยังไม่ระบุ'} · ช่องทาง {SOURCE_LABEL[focus.source]}
                </div>
              </div>

              <div className="row gap-2 wrap mt-4">
                {focus.status === 'waiting' && (
                  <button className="btn primary" disabled={busy}
                    onClick={() => act(`/queue/${focus.id}/call`, { barber_id: user.barber_id ?? undefined })}>
                    📢 เรียกคิว
                  </button>
                )}
                {focus.status === 'called' && (
                  <>
                    <button className="btn primary" disabled={busy}
                      onClick={() => act(`/queue/${focus.id}/start`, { barber_id: focus.barber_id ?? user.barber_id ?? undefined })}>
                      ▶ เริ่มให้บริการ
                    </button>
                    <button className="btn" disabled={busy} onClick={() => act(`/queue/${focus.id}/recall`)}>
                      🔁 เรียกซ้ำ{focus.recall_count > 0 ? ` (${focus.recall_count})` : ''}
                    </button>
                  </>
                )}
                {focus.status === 'serving' && (
                  <button className="btn primary" disabled={busy} onClick={() => act(`/queue/${focus.id}/done`)}>
                    ✓ ปิดคิว
                  </button>
                )}
                {['waiting', 'called'].includes(focus.status) && (
                  <>
                    <button className="btn" disabled={busy} onClick={() => act(`/queue/${focus.id}/skip`)}>
                      ⏭ ข้ามคิว
                    </button>
                    <button className="btn danger" disabled={busy}
                      onClick={() => { setCancelTarget(focus); setCancelReason(''); }}>
                      ✕ ยกเลิก
                    </button>
                  </>
                )}
              </div>
            </div>
          ) : (
            <Card><Empty icon="💈" title="ยังไม่มีคิววันนี้" hint="กด “ออกบัตรคิว” เพื่อเพิ่มลูกค้า" /></Card>
          )}

          <Card title="สถานะช่าง" tight>
            {barbers.map((b) => (
              <div key={b.id} className="queue-row">
                <Avatar name={b.full_name} size="sm" />
                <div className="grow">
                  <div className="small bold">{b.nickname || b.full_name}</div>
                  <div className="tiny muted">{b.code} · วันนี้ {b.served_today} คิว</div>
                </div>
                <select
                  className="select" style={{ height: 28, width: 118, fontSize: 12 }}
                  value={b.status}
                  onChange={async (e) => {
                    try {
                      await api.patch(`/barbers/${b.id}/status`, { status: e.target.value });
                      load();
                    } catch (err) { toast.error(err.message); }
                  }}
                >
                  <option value="available">ว่าง</option>
                  <option value="serving">ให้บริการ</option>
                  <option value="break">พัก</option>
                  <option value="off">ไม่อยู่</option>
                </select>
              </div>
            ))}
          </Card>
        </div>

        {/* ------------------------- รายการคิว ------------------------ */}
        <Card tight>
          <div className="row gap-1 wrap" style={{ padding: '4px 4px 12px' }}>
            {TABS.map((t) => (
              <button key={t.key}
                className={`btn sm ${tab === t.key ? 'dark' : 'ghost'}`}
                onClick={() => setTab(t.key)}>
                {t.label} ({counts[t.key]})
              </button>
            ))}
          </div>

          {filtered.length === 0 ? (
            <Empty icon="📋" title="ไม่มีคิวในหมวดนี้" />
          ) : (
            <div className="table-wrap">
              <table className="data">
                <thead>
                  <tr>
                    <th>ลำดับ</th>
                    <th>คิว</th>
                    <th>ลูกค้า</th>
                    <th>บริการ</th>
                    <th>ช่าง</th>
                    <th>สถานะ</th>
                    <th>เวลา</th>
                    <th className="right">การจัดการ</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} onClick={() => setSelectedId(t.id)} style={{ cursor: 'pointer' }}>
                      <td>{t.position ? <span className="pos-pill">{t.position}</span> : <span className="muted">—</span>}</td>
                      <td className="bold mono">{t.ticket_no}</td>
                      <td>
                        <div className="row gap-2">
                          <Avatar name={t.customer_name} size="sm" />
                          <div>
                            <div className="bold small">{t.customer_name}</div>
                            <div className="tiny muted">{t.customer_phone || SOURCE_LABEL[t.source]}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="small">{t.service_name}</div>
                        <div className="tiny muted">{t.duration_min} นาที · {baht(t.price)}</div>
                      </td>
                      <td className="small">{t.barber_name || <span className="muted">—</span>}</td>
                      <td><StatusBadge status={t.status} /></td>
                      <td className="small muted">
                        {t.status === 'waiting'
                          ? `รอมา ${sinceMinutes(t.issued_at)} นาที`
                          : timeOf(t.called_at || t.issued_at)}
                      </td>
                      <td onClick={(e) => e.stopPropagation()}>
                        <div className="actions">
                          {t.status === 'waiting' && (
                            <button className="btn sm" disabled={busy}
                              onClick={() => act(`/queue/${t.id}/call`, { barber_id: user.barber_id ?? undefined })}>เรียก</button>
                          )}
                          {t.status === 'called' && (
                            <>
                              <button className="btn sm" disabled={busy}
                                onClick={() => act(`/queue/${t.id}/start`, { barber_id: t.barber_id ?? user.barber_id ?? undefined })}>เริ่ม</button>
                              <button className="btn sm" disabled={busy}
                                onClick={() => act(`/queue/${t.id}/recall`)}>ซ้ำ</button>
                            </>
                          )}
                          {t.status === 'serving' && (
                            <button className="btn sm" disabled={busy}
                              onClick={() => act(`/queue/${t.id}/done`)}>ปิดคิว</button>
                          )}
                          {['waiting', 'called'].includes(t.status) && (
                            <>
                              <button className="btn sm" disabled={busy}
                                onClick={() => act(`/queue/${t.id}/skip`)}>ข้าม</button>
                              <button className="btn sm danger" disabled={busy}
                                onClick={() => { setCancelTarget(t); setCancelReason(''); }}>ยกเลิก</button>
                            </>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>

      <IssueTicketModal
        open={issueOpen}
        onClose={() => setIssueOpen(false)}
        services={services}
        barbers={barbers}
        onIssued={() => { setIssueOpen(false); load(); }}
      />

      <ConfirmModal
        open={!!cancelTarget}
        title={`ยกเลิกคิว ${cancelTarget?.ticket_no ?? ''}`}
        danger
        confirmText="ยืนยันยกเลิกคิว"
        busy={busy}
        onClose={() => setCancelTarget(null)}
        onConfirm={async () => {
          await act(`/queue/${cancelTarget.id}/cancel`, { reason: cancelReason });
          setCancelTarget(null);
        }}
        message={(
          <>
            <p>ลูกค้า <b>{cancelTarget?.customer_name}</b> จะได้รับการแจ้งเตือนว่าคิวถูกยกเลิก</p>
            <Field label="เหตุผล (ไม่บังคับ)">
              <input className="input" value={cancelReason} onChange={(e) => setCancelReason(e.target.value)}
                placeholder="เช่น ลูกค้าแจ้งยกเลิกเอง" />
            </Field>
          </>
        )}
      />
    </div>
  );
}

/* -------------------- โมดัลออกบัตรคิวหน้าร้าน -------------------- */
function IssueTicketModal({ open, onClose, services, barbers, onIssued }) {
  const toast = useToast();
  const [mode, setMode] = useState('guest');       // guest = walk-in | member = ลูกค้าสมาชิก
  const [customers, setCustomers] = useState([]);
  const [form, setForm] = useState({ service_id: '', barber_id: '', guest_name: '', guest_phone: '', customer_id: '' });
  const [result, setResult] = useState(null);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  useEffect(() => {
    if (!open) return;
    setResult(null);
    setErrors({});
    setForm({ service_id: services[0]?.id ?? '', barber_id: '', guest_name: '', guest_phone: '', customer_id: '' });
    api.get('/users', { role: 'customer', limit: 300 })
      .then((d) => setCustomers(d.data))
      .catch(() => setCustomers([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        service_id: Number(form.service_id),
        source: 'walk_in',
        ...(form.barber_id ? { barber_id: Number(form.barber_id) } : {}),
        ...(mode === 'member'
          ? { customer_id: Number(form.customer_id) }
          : { guest_name: form.guest_name, ...(form.guest_phone ? { guest_phone: form.guest_phone } : {}) }),
      };
      const d = await api.post('/queue', payload);
      setResult(d);
      toast.ok(`ออกบัตรคิว ${d.ticket.ticket_no} เรียบร้อย`);
    } catch (err) {
      toast.error(err.message);
      setErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} title="ออกบัตรคิว" onClose={onClose}
      footer={result
        ? <><button className="btn" onClick={() => setResult(null)}>ออกบัตรอีกใบ</button>
          <button className="btn dark" onClick={onIssued}>เสร็จสิ้น</button></>
        : <><button className="btn" onClick={onClose}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}ออกบัตรคิว</button></>}
    >
      {result ? (
        <div className="center">
          <div className="ticket-hero" style={{ minHeight: 'auto', alignItems: 'center' }}>
            <div>
              <div className="eyebrow">หมายเลขคิวของคุณ</div>
              <div className="number">{result.ticket.ticket_no}</div>
              <div className="meta">{result.ticket.service_name} · {result.ticket.duration_min} นาที</div>
            </div>
          </div>
          <img src={result.qr_code} alt="QR สำหรับติดตามคิว" width={190} height={190} className="mt-3" />
          <p className="small muted mt-2">ให้ลูกค้าสแกน QR นี้เพื่อติดตามคิวของตนเอง</p>
          <p className="tiny muted mt-1" style={{ wordBreak: 'break-all' }}>{result.track_url}</p>
        </div>
      ) : (
        <form onSubmit={submit} noValidate>
          <div className="row gap-2" style={{ marginBottom: 16 }}>
            <button type="button" className={`btn sm ${mode === 'guest' ? 'dark' : ''}`}
              onClick={() => setMode('guest')}>ลูกค้า Walk-in</button>
            <button type="button" className={`btn sm ${mode === 'member' ? 'dark' : ''}`}
              onClick={() => setMode('member')}>ลูกค้าสมาชิก</button>
          </div>

          {mode === 'guest' ? (
            <>
              <Field label="ชื่อลูกค้า" error={errors.guest_name}>
                <input className="input" value={form.guest_name} required
                  onChange={(e) => setForm((f) => ({ ...f, guest_name: e.target.value }))}
                  placeholder="เช่น คุณวิชัย" />
              </Field>
              <Field label="เบอร์โทรศัพท์ (ไม่บังคับ)" error={errors.guest_phone}>
                <input className="input" value={form.guest_phone}
                  onChange={(e) => setForm((f) => ({ ...f, guest_phone: e.target.value }))}
                  placeholder="08x-xxx-xxxx" />
              </Field>
            </>
          ) : (
            <Field label="เลือกลูกค้า" error={errors.customer_id}>
              <select className="select" value={form.customer_id} required
                onChange={(e) => setForm((f) => ({ ...f, customer_id: e.target.value }))}>
                <option value="">— เลือกลูกค้า —</option>
                {customers.map((c) => (
                  <option key={c.id} value={c.id}>{c.full_name} ({c.phone || c.email})</option>
                ))}
              </select>
            </Field>
          )}

          <Field label="บริการ" error={errors.service_id}>
            <select className="select" value={form.service_id} required
              onChange={(e) => setForm((f) => ({ ...f, service_id: e.target.value }))}>
              {services.map((s) => (
                <option key={s.id} value={s.id}>{s.name} — {s.duration_min} นาที · {baht(s.price)}</option>
              ))}
            </select>
          </Field>

          <Field label="เลือกช่าง (ไม่บังคับ)" hint="ไม่เลือก = ช่างคนไหนว่างก่อนได้เลย">
            <select className="select" value={form.barber_id}
              onChange={(e) => setForm((f) => ({ ...f, barber_id: e.target.value }))}>
              <option value="">— ไม่ระบุ —</option>
              {barbers.filter((b) => b.status !== 'off').map((b) => (
                <option key={b.id} value={b.id}>{b.full_name} ({b.code})</option>
              ))}
            </select>
          </Field>
        </form>
      )}
    </Modal>
  );
}
