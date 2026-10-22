/**
 * จัดการข้อมูลช่างตัดผม (ส่วนหนึ่งของ User Management)
 */
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { broadcast } from '../utils/realtime.js';

/** GET /api/barbers */
export const listBarbers = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT b.id, b.code, b.nickname, b.specialty, b.bio, b.status, b.rating, b.hired_at,
            u.id AS user_id, u.full_name, u.email, u.phone, u.avatar_url,
            (SELECT COUNT(*) FROM queue_tickets q
              WHERE q.barber_id = b.id AND q.queue_date = CURRENT_DATE AND q.status = 'done') AS served_today,
            (SELECT row_to_json(x) FROM (
                SELECT vb.ticket_no, vb.customer_name, vb.service_name, vb.started_at
                  FROM v_queue_board vb
                 WHERE vb.barber_id = b.id AND vb.status = 'serving'
                 LIMIT 1) x)                                                                  AS current_ticket
       FROM barbers b JOIN users u ON u.id = b.user_id
      WHERE ($1::text IS NULL OR b.status = $1::barber_status)
      ORDER BY b.code`,
    [req.query.status || null],
  );
  res.json({ data: rows });
});

/** PATCH /api/barbers/:id/status — เปลี่ยนสถานะช่าง (ว่าง/พัก/เลิกงาน) */
export const updateBarberStatus = asyncHandler(async (req, res) => {
  const { status } = validate(req.body, {
    status: { type: 'enum', enum: ['available', 'serving', 'break', 'off'], required: true, label: 'สถานะ' },
  });

  // ช่างแก้ได้เฉพาะสถานะของตัวเอง ส่วน admin/staff แก้ได้ทุกคน
  if (req.user.role === 'barber' && req.user.barber_id !== Number(req.params.id)) {
    throw ApiError.forbidden('แก้ไขได้เฉพาะสถานะของตนเอง');
  }

  const { rows } = await query('UPDATE barbers SET status = $1 WHERE id = $2 RETURNING *', [status, req.params.id]);
  if (!rows[0]) throw ApiError.notFound('ไม่พบช่างตัดผมคนนี้');

  broadcast('barber:update', rows[0]);
  res.json({ barber: rows[0] });
});

/** PUT /api/barbers/:id */
export const updateBarber = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    code: { type: 'string', max: 20, label: 'รหัสช่าง' },
    nickname: { type: 'string', max: 80, label: 'ชื่อเล่น' },
    specialty: { type: 'string', max: 150, label: 'ความถนัด' },
    bio: { type: 'string', max: 1000, label: 'ประวัติ' },
    status: { type: 'enum', enum: ['available', 'serving', 'break', 'off'], label: 'สถานะ' },
    rating: { type: 'number', min: 0, label: 'คะแนน' },
  });

  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('ไม่มีข้อมูลที่ต้องการแก้ไข');

  params.push(req.params.id);
  const { rows } = await query(`UPDATE barbers SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw ApiError.notFound('ไม่พบช่างตัดผมคนนี้');
  res.json({ barber: rows[0] });
});
