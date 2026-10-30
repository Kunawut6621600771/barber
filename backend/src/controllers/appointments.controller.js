/**
 * Module: จองคิวล่วงหน้า
 *
 *   ลูกค้าเลือกวัน-เวลา-บริการ ระบบกันช่วงเวลาไว้ให้
 *   ถึงวันจริง พนักงานกด "เปลี่ยนเป็นบัตรคิว" เพื่อออกคิวโดยมี priority สูงกว่า walk-in
 *
 *   GET    /api/appointments/slots        ช่วงเวลาที่ว่างของวันนั้น (public)
 *   GET    /api/appointments/my           การจองของฉัน
 *   GET    /api/appointments              รายการจอง (พนักงาน)
 *   POST   /api/appointments              สร้างการจอง
 *   POST   /api/appointments/:id/cancel   ยกเลิกการจอง
 *   POST   /api/appointments/:id/checkin  เปลี่ยนการจองเป็นบัตรคิว (พนักงาน)
 */
import { query, withTransaction, shopToday } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { getSettings, num, bool } from '../utils/settings.js';
import { issueTicket, ticketResponse } from './queue.controller.js';

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

const detailSql = `
  SELECT a.*,
         COALESCE(u.full_name, a.guest_name)  AS customer_name,
         COALESCE(u.phone,     a.guest_phone) AS customer_phone,
         s.name  AS service_name, s.price, s.duration_min,
         bu.full_name AS barber_name, b.code AS barber_code,
         q.ticket_no
    FROM appointments a
    JOIN services s      ON s.id  = a.service_id
    LEFT JOIN users u    ON u.id  = a.customer_id
    LEFT JOIN barbers b  ON b.id  = a.barber_id
    LEFT JOIN users bu   ON bu.id = b.user_id
    LEFT JOIN queue_tickets q ON q.id = a.ticket_id`;

/** สร้างช่วงเวลาทั้งหมดของวัน ตามเวลาเปิด-ปิดร้านและความถี่ที่ตั้งไว้ */
function buildSlots(openTime, closeTime, stepMin) {
  const toMin = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const slots = [];
  for (let m = toMin(openTime); m + stepMin <= toMin(closeTime); m += stepMin) {
    slots.push(`${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}`);
  }
  return slots;
}

/** GET /api/appointments/slots?date=&barber_id= */
export const availableSlots = asyncHandler(async (req, res) => {
  const s = await getSettings();
  if (!bool(s.booking_enabled, true)) throw ApiError.badRequest('ร้านปิดการจองล่วงหน้าอยู่');

  const date = req.query.date || shopToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw ApiError.badRequest('รูปแบบวันที่ไม่ถูกต้อง');

  const maxDays = num(s.booking_max_days, 14);
  const limitDate = new Date(`${shopToday()}T00:00:00`);
  limitDate.setDate(limitDate.getDate() + maxDays);
  if (date < shopToday()) throw ApiError.badRequest('เลือกวันย้อนหลังไม่ได้');
  if (new Date(`${date}T00:00:00`) > limitDate) throw ApiError.badRequest(`จองล่วงหน้าได้ไม่เกิน ${maxDays} วัน`);

  const step = num(s.booking_slot_min, 30);
  const all = buildSlots(s.open_time, s.close_time, step);

  // จำนวนช่างที่รับงานได้ = เพดานการจองต่อช่วงเวลา
  const { rows: barberRows } = await query(
    `SELECT COUNT(*)::int AS n FROM barbers WHERE status <> 'off'`,
  );
  const capacity = Math.max(barberRows[0].n, 1);

  const params = [date];
  let barberSql = '';
  if (req.query.barber_id) {
    params.push(req.query.barber_id);
    barberSql = `AND barber_id = $${params.length}`;
  }

  const { rows: booked } = await query(
    `SELECT TO_CHAR(appoint_time, 'HH24:MI') AS t, COUNT(*)::int AS n
       FROM appointments
      WHERE appoint_date = $1 AND status IN ('pending','confirmed') ${barberSql}
      GROUP BY 1`,
    params,
  );
  const taken = Object.fromEntries(booked.map((r) => [r.t, r.n]));

  // วันนี้ไม่ให้จองย้อนเวลา
  const nowHHMM = new Intl.DateTimeFormat('en-GB', {
    timeZone: 'Asia/Bangkok', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(new Date());
  const isToday = date === shopToday();
  const perSlot = req.query.barber_id ? 1 : capacity;

  res.json({
    date,
    slot_minutes: step,
    capacity: perSlot,
    slots: all.map((time) => ({
      time,
      booked: taken[time] || 0,
      available: (taken[time] || 0) < perSlot && !(isToday && time <= nowHHMM),
    })),
  });
});

export const myAppointments = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `${detailSql} WHERE a.customer_id = $1 ORDER BY a.appoint_date DESC, a.appoint_time DESC LIMIT 50`,
    [req.user.id],
  );
  res.json({ data: rows });
});

export const listAppointments = asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.date) { params.push(req.query.date); where.push(`a.appoint_date = $${params.length}`); }
  if (req.query.from) { params.push(req.query.from); where.push(`a.appoint_date >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`a.appoint_date <= $${params.length}`); }
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where.push(`a.status = ANY($${params.length}::appointment_status[])`);
  }

  const { rows } = await query(
    `${detailSql} ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY a.appoint_date, a.appoint_time LIMIT 200`,
    params,
  );
  res.json({ data: rows });
});

export const createAppointment = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    service_id: { type: 'int', required: true, label: 'บริการ' },
    barber_id: { type: 'int', label: 'ช่าง' },
    appoint_date: { type: 'date', required: true, label: 'วันที่' },
    appoint_time: { type: 'string', required: true, max: 5, label: 'เวลา' },
    customer_id: { type: 'int', label: 'ลูกค้า' },
    guest_name: { type: 'string', max: 150, label: 'ชื่อลูกค้า' },
    guest_phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    note: { type: 'string', max: 300, label: 'หมายเหตุ' },
  });

  if (!TIME_RE.test(d.appoint_time)) throw ApiError.badRequest('รูปแบบเวลาไม่ถูกต้อง (HH:MM)');

  const s = await getSettings();
  if (!bool(s.booking_enabled, true)) throw ApiError.badRequest('ร้านปิดการจองล่วงหน้าอยู่');
  if (d.appoint_date < shopToday()) throw ApiError.badRequest('เลือกวันย้อนหลังไม่ได้');

  const maxDays = num(s.booking_max_days, 14);
  const limitDate = new Date(`${shopToday()}T00:00:00`);
  limitDate.setDate(limitDate.getDate() + maxDays);
  if (new Date(`${d.appoint_date}T00:00:00`) > limitDate) {
    throw ApiError.badRequest(`จองล่วงหน้าได้ไม่เกิน ${maxDays} วัน`);
  }
  if (d.appoint_time < s.open_time || d.appoint_time >= s.close_time) {
    throw ApiError.badRequest(`ร้านเปิด ${s.open_time} - ${s.close_time} น. เท่านั้น`);
  }

  const isStaff = ['admin', 'staff', 'barber'].includes(req.user.role);
  const customerId = isStaff ? (d.customer_id ?? null) : req.user.id;
  const guestName = isStaff ? (d.guest_name ?? null) : null;
  if (!customerId && !guestName) throw ApiError.badRequest('กรุณาระบุลูกค้า หรือชื่อผู้จอง');

  const appointment = await withTransaction(async (client) => {
    // ล็อกวันนั้นไว้ กันจองชนกันตอนกดพร้อมกัน
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`appoint_${d.appoint_date}`]);

    const { rows: svc } = await client.query(
      'SELECT id FROM services WHERE id = $1 AND is_active = TRUE', [d.service_id],
    );
    if (!svc[0]) throw ApiError.badRequest('ไม่พบบริการนี้ หรือบริการถูกปิดอยู่');

    const { rows: cap } = await client.query(`SELECT COUNT(*)::int AS n FROM barbers WHERE status <> 'off'`);
    const capacity = d.barber_id ? 1 : Math.max(cap[0].n, 1);

    const params = [d.appoint_date, d.appoint_time];
    let barberSql = '';
    if (d.barber_id) { params.push(d.barber_id); barberSql = `AND barber_id = $${params.length}`; }

    const { rows: taken } = await client.query(
      `SELECT COUNT(*)::int AS n FROM appointments
        WHERE appoint_date = $1 AND appoint_time = $2::time
          AND status IN ('pending','confirmed') ${barberSql}`,
      params,
    );
    if (taken[0].n >= capacity) throw ApiError.conflict('ช่วงเวลานี้ถูกจองเต็มแล้ว กรุณาเลือกเวลาอื่น');

    const { rows } = await client.query(
      `INSERT INTO appointments (customer_id, guest_name, guest_phone, service_id, barber_id,
                                 appoint_date, appoint_time, note, source)
       VALUES ($1,$2,$3,$4,$5,$6,$7::time,$8,$9) RETURNING id`,
      [customerId, guestName, d.guest_phone ?? null, d.service_id, d.barber_id ?? null,
        d.appoint_date, d.appoint_time, d.note ?? null, isStaff ? 'walk_in' : 'online'],
    ).catch((err) => {
      if (err.code === '23505') throw ApiError.conflict('คุณจองช่วงเวลานี้ไว้แล้ว');
      throw err;
    });

    const { rows: full } = await client.query(`${detailSql} WHERE a.id = $1`, [rows[0].id]);
    return full[0];
  });

  res.status(201).json({
    appointment,
    message: `จองคิววันที่ ${appointment.appoint_date} เวลา ${String(appointment.appoint_time).slice(0, 5)} น. เรียบร้อยแล้ว`,
  });
});

export const cancelAppointment = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM appointments WHERE id = $1', [req.params.id]);
  const appt = rows[0];
  if (!appt) throw ApiError.notFound('ไม่พบการจองนี้');

  const isStaff = ['admin', 'staff', 'barber'].includes(req.user.role);
  if (!isStaff && appt.customer_id !== req.user.id) throw ApiError.forbidden('ยกเลิกได้เฉพาะการจองของตนเอง');
  if (!['pending', 'confirmed'].includes(appt.status)) throw ApiError.conflict('การจองนี้ยกเลิกไม่ได้แล้ว');

  await query(`UPDATE appointments SET status = 'cancelled' WHERE id = $1`, [req.params.id]);
  res.json({ message: 'ยกเลิกการจองเรียบร้อยแล้ว' });
});

/** POST /api/appointments/:id/checkin — ลูกค้ามาถึงร้าน ออกบัตรคิวให้ */
export const checkinAppointment = asyncHandler(async (req, res) => {
  const result = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM appointments WHERE id = $1 FOR UPDATE', [req.params.id]);
    const appt = rows[0];
    if (!appt) throw ApiError.notFound('ไม่พบการจองนี้');
    if (appt.status !== 'confirmed' && appt.status !== 'pending') {
      throw ApiError.conflict('การจองนี้ถูกใช้หรือยกเลิกไปแล้ว');
    }
    if (appt.appoint_date !== shopToday()) {
      throw ApiError.badRequest(`การจองนี้เป็นของวันที่ ${appt.appoint_date} ไม่ใช่วันนี้`);
    }

    // ลูกค้าที่จองล่วงหน้าได้คิวก่อน walk-in
    const issued = await issueTicket(client, {
      customerId: appt.customer_id,
      guestName: appt.guest_name,
      guestPhone: appt.guest_phone,
      serviceId: appt.service_id,
      barberId: appt.barber_id,
      source: 'online',
      priority: 5,
      actorId: req.user.id,
    });

    await client.query(
      `UPDATE appointments SET status = 'done', ticket_id = $2 WHERE id = $1`,
      [appt.id, issued.ticket.id],
    );
    return issued;
  });

  res.status(201).json({
    ...(await ticketResponse(result)),
    message: `ออกบัตรคิว ${result.ticket.ticket_no} จากการจองล่วงหน้าแล้ว`,
  });
});
