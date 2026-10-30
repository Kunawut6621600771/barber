import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useRealtime } from '../api/realtime.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth, isStaffRole } from '../context/AuthContext.jsx';
import {
  Card, ConfirmModal, Field, Empty, Loading, Alert, ServiceThumb, Avatar,
  SOURCE_LABEL, baht, dateOf, dateTimeOf,
} from '../components/ui.jsx';

const STATUS = {
  pending: { label: 'รอยืนยัน', cls: 'warn' },
  confirmed: { label: 'ยืนยันแล้ว', cls: 'ok' },
  cancelled: { label: 'ยกเลิก', cls: 'danger' },
  done: { label: 'มาแล้ว', cls: 'info' },
  no_show: { label: 'ไม่มาตามนัด', cls: 'danger' },
};

const todayStr = () => new Date().toLocaleDateString('en-CA');
const hhmm = (t) => String(t || '').slice(0, 5);

/** การ์ดการจอง 1 รายการ แสดงรูปและชื่อบัญชี LINE ของผู้จอง (พนักงาน) */
function BookingCard({ appt, onCheckin, onCancel }) {
  const st = STATUS[appt.status] || { label: appt.status, cls: '' };
  const isToday = appt.appoint_date === todayStr();
  const lineName = appt.line_display_name;
  const realName = appt.customer_name;

  return (
    <div className={`book-card ${isToday ? 'today' : ''}`}>
      <div className="book-card-head">
        {appt.line_picture_url
          ? <img src={appt.line_picture_url} alt="" className="book-card-pic" referrerPolicy="no-referrer" />
          : <Avatar name={lineName || realName} size="lg" />}
        <div style={{ minWidth: 0, flex: 1 }}>
          <div className="bold truncate">{lineName || realName || 'ลูกค้า'}</div>
          {lineName && realName && realName !== lineName && (
            <div className="tiny muted truncate">ชื่อในระบบ: {realName}</div>
          )}
          <div className="row gap-1 wrap" style={{ marginTop: 4 }}>
            {appt.line_linked
              ? <span className="badge line">LINE</span>
              : <span className="badge">{SOURCE_LABEL[appt.source] || appt.source}</span>}
            <span className={`badge ${st.cls}`}><i className="dot-i" />{st.label}</span>
          </div>
        </div>
      </div>

      <div className="book-card-when">
        <div>
          <div className="tiny muted">{isToday ? 'วันนี้' : dateOf(appt.appoint_date)}</div>
          <div className="book-card-time">{hhmm(appt.appoint_time)} <small>น.</small></div>
        </div>
        <div style={{ textAlign: 'right' }}>
          <div className="tiny muted">ราคา</div>
          <div className="bold">{baht(appt.price)}</div>
        </div>
      </div>

      <div className="dl book-card-dl">
        <dt>บริการ</dt><dd>{appt.service_name}</dd>
        <dt>ใช้เวลา</dt><dd>{appt.duration_min} นาที</dd>
        <dt>ช่าง</dt><dd>{appt.barber_name || 'ร้านจัดให้'}</dd>
        <dt>เบอร์โทร</dt>
        <dd>{appt.customer_phone ? <a href={`tel:${appt.customer_phone}`}>{appt.customer_phone}</a> : '—'}</dd>
        {appt.note && <><dt>หมายเหตุ</dt><dd>{appt.note}</dd></>}
        <dt>จองเมื่อ</dt><dd>{dateTimeOf(appt.created_at)}</dd>
      </div>

      <div className="book-card-foot">
        <button
          className="btn sm primary"
          onClick={() => onCheckin(appt)}
          disabled={!isToday}
          title={isToday ? 'ออกบัตรคิว' : 'เช็กอินได้เฉพาะวันที่นัด'}
        >
          เช็กอิน
        </button>
        <button className="btn sm danger" onClick={() => onCancel(appt)}>ยกเลิก</button>
      </div>
    </div>
  );
}

export default function Book() {
  const toast = useToast();
  const { user } = useAuth();
  const staff = isStaffRole(user.role);

  const [services, setServices] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [shop, setShop] = useState(null);
  const [mine, setMine] = useState([]);
  const [staffList, setStaffList] = useState([]);
  const [loading, setLoading] = useState(true);

  const [date, setDate] = useState(todayStr());
  const [serviceId, setServiceId] = useState('');
  const [barberId, setBarberId] = useState('');
  const [slots, setSlots] = useState(null);
  const [slotLoading, setSlotLoading] = useState(false);
  const [picked, setPicked] = useState(null);
  const [busy, setBusy] = useState(false);
  const [cancelling, setCancelling] = useState(null);

  const loadBase = useCallback(async () => {
    try {
      const [svc, brb, info] = await Promise.all([
        api.get('/services/public'),
        api.get('/barbers').catch(() => ({ data: [] })),
        api.get('/settings/public'),
      ]);
      setServices(svc.data);
      setBarbers(brb.data);
      setShop(info);
      if (svc.data[0]) setServiceId(String(svc.data[0].id));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  const loadMine = useCallback(async () => {
    try {
      setMine((await api.get('/appointments/my')).data);
    } catch { /* ไม่รบกวนผู้ใช้ */ }
  }, []);

  const loadStaffList = useCallback(async () => {
    if (!staff) return;
    try {
      setStaffList((await api.get('/appointments', { from: todayStr(), status: 'pending,confirmed' })).data);
    } catch { /* ignore */ }
  }, [staff]);

  useEffect(() => { loadBase(); loadMine(); loadStaffList(); }, [loadBase, loadMine, loadStaffList]);

  // ลูกค้าจองหรือยกเลิกผ่าน LINE -> การ์ดของพนักงานอัปเดตทันที
  useRealtime({ 'appointment:update': loadStaffList }, staff);

  const [filter, setFilter] = useState('all'); // all | line | today
  const shownStaffList = useMemo(() => staffList.filter((a) => {
    if (filter === 'line') return a.line_linked;
    if (filter === 'today') return a.appoint_date === todayStr();
    return true;
  }), [staffList, filter]);
  const lineCount = staffList.filter((a) => a.line_linked).length;
  const todayCount = staffList.filter((a) => a.appoint_date === todayStr()).length;

  const loadSlots = useCallback(async () => {
    setSlotLoading(true);
    setPicked(null);
    try {
      setSlots(await api.get('/appointments/slots', { date, barber_id: barberId || undefined }));
    } catch (err) {
      setSlots(null);
      toast.error(err.message);
    } finally {
      setSlotLoading(false);
    }
  }, [date, barberId, toast]);

  useEffect(() => { if (shop?.booking_enabled) loadSlots(); }, [shop, loadSlots]);

  const service = useMemo(
    () => services.find((s) => String(s.id) === serviceId),
    [services, serviceId],
  );

  const maxDate = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() + (Number(shop?.booking_max_days) || 14));
    return d.toLocaleDateString('en-CA');
  }, [shop]);

  const book = async () => {
    setBusy(true);
    try {
      const r = await api.post('/appointments', {
        service_id: Number(serviceId),
        barber_id: barberId ? Number(barberId) : undefined,
        appoint_date: date,
        appoint_time: picked,
      });
      toast.success(r.message);
      setPicked(null);
      loadSlots();
      loadMine();
      loadStaffList();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const cancel = async () => {
    setBusy(true);
    try {
      toast.success((await api.post(`/appointments/${cancelling.id}/cancel`)).message);
      setCancelling(null);
      loadMine();
      loadSlots();
      loadStaffList();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const checkin = async (appt) => {
    try {
      const r = await api.post(`/appointments/${appt.id}/checkin`);
      toast.success(r.message);
      loadStaffList();
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="page"><Loading rows={5} /></div>;

  if (!shop?.booking_enabled) {
    return (
      <div className="page">
        <div className="page-head"><h1>จองคิวล่วงหน้า</h1></div>
        <Card>
          <Empty
            icon="📅"
            title="ตอนนี้ร้านปิดการจองล่วงหน้า"
            hint="รับคิวแบบ walk-in ได้ตามปกติที่หน้า “รับบัตรคิว”"
          />
        </Card>
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-head">
        <h1>จองคิวล่วงหน้า</h1>
        <div className="sub">
          เปิด {shop.open_days} · {shop.open_time} - {shop.close_time} น. · จองล่วงหน้าได้ถึง {maxDate}
        </div>
      </div>

      <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1fr) 340px' }}>
        <div className="col gap-3">
          <Card title="1. เลือกบริการ">
            <div className="grid grid-auto">
              {services.map((s) => (
                <button
                  key={s.id}
                  className={`svc-card selectable ${String(s.id) === serviceId ? 'selected' : ''}`}
                  onClick={() => setServiceId(String(s.id))}
                  style={{ textAlign: 'left', cursor: 'pointer', padding: 0 }}
                >
                  <ServiceThumb service={s}>
                    {s.category_name && <span className="svc-tag">{s.category_name}</span>}
                  </ServiceThumb>
                  <div className="body">
                    <div className="bold">{s.name}</div>
                    <div className="small muted">{s.description || `ใช้เวลาประมาณ ${s.duration_min} นาที`}</div>
                    <div className="price">{baht(s.price)}</div>
                  </div>
                  <div className="foot">
                    <span>⏱ {s.duration_min} นาที</span>
                    {String(s.id) === serviceId && <span className="badge ok"><i className="dot-i" />เลือกแล้ว</span>}
                  </div>
                </button>
              ))}
            </div>
          </Card>

          <Card title="2. เลือกวันและช่าง">
            <div className="row gap-2 wrap">
              <Field label="วันที่">
                <input
                  className="input"
                  type="date"
                  min={todayStr()}
                  max={maxDate}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                />
              </Field>
              <Field label="ช่าง" hint="ไม่เลือกก็ได้ ร้านจะจัดช่างที่ว่างให้">
                <select className="select" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
                  <option value="">— ช่างคนไหนก็ได้ —</option>
                  {barbers.filter((b) => b.status !== 'off').map((b) => (
                    <option key={b.id} value={b.id}>{b.full_name} ({b.code})</option>
                  ))}
                </select>
              </Field>
            </div>
          </Card>

          <Card
            title="3. เลือกเวลา"
            subtitle={slots ? `ช่วงละ ${slots.slot_minutes} นาที · รับได้ช่วงละ ${slots.capacity} คิว` : undefined}
          >
            {slotLoading ? <Loading rows={3} /> : !slots ? (
              <Empty icon="🕐" title="เลือกวันที่เพื่อดูเวลาว่าง" />
            ) : slots.slots.every((s) => !s.available) ? (
              <Empty icon="😢" title="วันนี้เต็มแล้ว" hint="ลองเลือกวันอื่น หรือมารับคิวแบบ walk-in ที่ร้าน" />
            ) : (
              <div className="chips">
                {slots.slots.map((s) => (
                  <button
                    key={s.time}
                    className={`chip ${picked === s.time ? 'active' : ''}`}
                    disabled={!s.available}
                    onClick={() => setPicked(s.time)}
                    style={!s.available ? { opacity: 0.35, cursor: 'not-allowed', textDecoration: 'line-through' } : undefined}
                    title={s.available ? `ว่าง (จองแล้ว ${s.booked}/${slots.capacity})` : 'เต็มหรือเลยเวลาแล้ว'}
                  >
                    {s.time}
                  </button>
                ))}
              </div>
            )}
          </Card>
        </div>

        <div className="col gap-3">
          <Card title="สรุปการจอง">
            <div className="dl" style={{ marginBottom: 14 }}>
              <dt>บริการ</dt><dd>{service?.name || '—'}</dd>
              <dt>ราคา</dt><dd>{service ? baht(service.price) : '—'}</dd>
              <dt>ใช้เวลา</dt><dd>{service ? `${service.duration_min} นาที` : '—'}</dd>
              <dt>วันที่</dt><dd>{dateOf(date)}</dd>
              <dt>เวลา</dt><dd>{picked ? `${picked} น.` : '—'}</dd>
              <dt>ช่าง</dt>
              <dd>{barberId ? barbers.find((b) => String(b.id) === barberId)?.full_name : 'ร้านจัดให้'}</dd>
            </div>

            <button className="btn primary block lg" onClick={book} disabled={busy || !picked || !serviceId}>
              {busy && <span className="spinner" />}
              {picked ? `ยืนยันจอง ${picked} น.` : 'เลือกเวลาก่อน'}
            </button>

            <Alert kind="info">ลูกค้าที่จองล่วงหน้าจะได้คิวก่อนลูกค้า walk-in เมื่อมาถึงร้าน</Alert>
          </Card>

          <Card title="การจองของฉัน">
            {mine.length === 0 ? (
              <Empty icon="📋" title="ยังไม่มีการจอง" />
            ) : (
              <div className="col">
                {mine.slice(0, 8).map((a) => {
                  const st = STATUS[a.status] || { label: a.status, cls: '' };
                  return (
                    <div key={a.id} className="row-between" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                      <div style={{ minWidth: 0 }}>
                        <div className="bold small">{dateOf(a.appoint_date)} · {hhmm(a.appoint_time)} น.</div>
                        <div className="tiny muted">{a.service_name}{a.barber_name ? ` · ${a.barber_name}` : ''}</div>
                        {a.ticket_no && <div className="tiny muted">ออกบัตรคิว {a.ticket_no} แล้ว</div>}
                      </div>
                      <div className="row gap-2">
                        <span className={`badge ${st.cls}`}><i className="dot-i" />{st.label}</span>
                        {['pending', 'confirmed'].includes(a.status) && (
                          <button className="btn ghost sm" onClick={() => setCancelling(a)} title="ยกเลิก">✕</button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </Card>
        </div>
      </div>

      {staff && (
        <Card
          title="การจองที่กำลังจะถึง (ทั้งร้าน)"
          subtitle="รายชื่อลูกค้าที่จองผ่าน LINE / ออนไลน์ · กด “เช็กอิน” เพื่อออกบัตรคิวเมื่อลูกค้ามาถึง"
          className="mt-4"
          action={(
            <div className="chips">
              <button className={`chip ${filter === 'all' ? 'active' : ''}`} onClick={() => setFilter('all')}>
                ทั้งหมด ({staffList.length})
              </button>
              <button className={`chip ${filter === 'line' ? 'active' : ''}`} onClick={() => setFilter('line')}>
                จองผ่าน LINE ({lineCount})
              </button>
              <button className={`chip ${filter === 'today' ? 'active' : ''}`} onClick={() => setFilter('today')}>
                วันนี้ ({todayCount})
              </button>
            </div>
          )}
        >
          {shownStaffList.length === 0 ? (
            <Empty icon="📅" title="ยังไม่มีการจองที่กำลังจะถึง" />
          ) : (
            <div className="book-card-grid">
              {shownStaffList.map((a) => (
                <BookingCard key={a.id} appt={a} onCheckin={checkin} onCancel={setCancelling} />
              ))}
            </div>
          )}
        </Card>
      )}

      <ConfirmModal
        open={!!cancelling}
        title="ยกเลิกการจอง"
        message={cancelling
          ? `ยกเลิกการจองวันที่ ${dateOf(cancelling.appoint_date)} เวลา ${hhmm(cancelling.appoint_time)} น. ใช่ไหม`
          : ''}
        confirmText="ยกเลิกการจอง"
        danger
        busy={busy}
        onConfirm={cancel}
        onClose={() => setCancelling(null)}
      />
    </div>
  );
}
