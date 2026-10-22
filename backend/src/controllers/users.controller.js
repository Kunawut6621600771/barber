/**
 * Module: User Management
 *  จัดการข้อมูลลูกค้า / พนักงาน / ช่างตัดผม / ข้อมูลส่วนตัว
 */
import bcrypt from 'bcryptjs';
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';

const USER_FIELDS = `u.id, u.full_name, u.email, u.phone, u.role, u.status,
                     u.avatar_url, u.birth_date, u.note, u.last_login_at, u.created_at`;

/** GET /api/users?role=&search=&status=&page=&limit= */
export const listUsers = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const params = [];
  const where = [];

  if (req.query.role) {
    params.push(req.query.role);
    where.push(`u.role = $${params.length}`);
  }
  if (req.query.status) {
    params.push(req.query.status);
    where.push(`u.status = $${params.length}`);
  }
  if (req.query.search) {
    params.push(`%${req.query.search.trim()}%`);
    where.push(`(u.full_name ILIKE $${params.length} OR u.email ILIKE $${params.length} OR u.phone ILIKE $${params.length})`);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT ${USER_FIELDS},
            b.id AS barber_id, b.code AS barber_code, b.status AS barber_status,
            (SELECT COUNT(*) FROM queue_tickets q
              WHERE q.customer_id = u.id AND q.status = 'done')      AS total_visits,
            (SELECT MAX(q.finished_at) FROM queue_tickets q
              WHERE q.customer_id = u.id AND q.status = 'done')      AS last_visit_at,
            COUNT(*) OVER() AS total_count
       FROM users u
       LEFT JOIN barbers b ON b.user_id = u.id
       ${whereSql}
      ORDER BY u.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const total = rows[0]?.total_count ?? 0;
  res.json({
    data: rows.map(({ total_count, ...r }) => r),
    pagination: { page, limit, total: Number(total), pages: Math.ceil(total / limit) },
  });
});

/** GET /api/users/:id */
export const getUser = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT ${USER_FIELDS}, b.id AS barber_id, b.code AS barber_code,
            b.nickname, b.specialty, b.bio, b.status AS barber_status, b.rating
       FROM users u LEFT JOIN barbers b ON b.user_id = u.id
      WHERE u.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) throw ApiError.notFound('ไม่พบผู้ใช้งานนี้');

  const { rows: history } = await query(
    `SELECT id, ticket_no, queue_date, status, service_name, barber_name, price, finished_at
       FROM v_queue_board WHERE customer_id = $1
      ORDER BY queue_date DESC, seq DESC LIMIT 20`,
    [req.params.id],
  );

  res.json({ user: rows[0], history });
});

/** POST /api/users — เพิ่มผู้ใช้ (ลูกค้า / พนักงาน / ช่าง) */
export const createUser = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', required: true, min: 2, max: 150, label: 'ชื่อ-นามสกุล' },
    email: { type: 'email', required: true, label: 'อีเมล' },
    phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    role: { type: 'enum', enum: ['admin', 'staff', 'barber', 'customer'], default: 'customer', label: 'ประเภทผู้ใช้' },
    status: { type: 'enum', enum: ['active', 'inactive', 'suspended'], default: 'active', label: 'สถานะ' },
    birth_date: { type: 'date', label: 'วันเกิด' },
    note: { type: 'string', max: 500, label: 'หมายเหตุ' },
    // เฉพาะ role = barber
    barber_code: { type: 'string', max: 20, label: 'รหัสช่าง' },
    nickname: { type: 'string', max: 80, label: 'ชื่อเล่น' },
    specialty: { type: 'string', max: 150, label: 'ความถนัด' },
  });

  const password = req.body.password;
  const hash = password ? await bcrypt.hash(password, 10) : null; // ไม่ใส่รหัส = ให้ผู้ใช้ Create Password เอง

  const user = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO users (full_name, email, phone, password_hash, role, status, birth_date, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
      [data.full_name, data.email, data.phone ?? null, hash, data.role, data.status,
        data.birth_date ?? null, data.note ?? null],
    );
    const created = rows[0];

    if (created.role === 'barber') {
      const code = data.barber_code || `BB-${String(created.id).padStart(2, '0')}`;
      await client.query(
        `INSERT INTO barbers (user_id, code, nickname, specialty, status, hired_at)
         VALUES ($1,$2,$3,$4,'off',CURRENT_DATE)`,
        [created.id, code, data.nickname ?? null, data.specialty ?? null],
      );
    }
    return created;
  });

  delete user.password_hash;
  res.status(201).json({ user });
});

/** PUT /api/users/:id */
export const updateUser = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', min: 2, max: 150, label: 'ชื่อ-นามสกุล' },
    email: { type: 'email', label: 'อีเมล' },
    phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    role: { type: 'enum', enum: ['admin', 'staff', 'barber', 'customer'], label: 'ประเภทผู้ใช้' },
    status: { type: 'enum', enum: ['active', 'inactive', 'suspended'], label: 'สถานะ' },
    birth_date: { type: 'date', label: 'วันเกิด' },
    note: { type: 'string', max: 500, label: 'หมายเหตุ' },
    nickname: { type: 'string', max: 80, label: 'ชื่อเล่น' },
    specialty: { type: 'string', max: 150, label: 'ความถนัด' },
    barber_code: { type: 'string', max: 20, label: 'รหัสช่าง' },
  });

  const targetId = Number(req.params.id);
  // กันไม่ให้ผู้ดูแลคนสุดท้ายลดสิทธิ์/ปิดบัญชีตัวเองจนไม่มีใครเข้าระบบได้
  if (targetId === req.user.id && (data.role && data.role !== 'admin' || data.status && data.status !== 'active')) {
    throw ApiError.badRequest('ไม่สามารถลดสิทธิ์หรือระงับบัญชีของตนเองได้');
  }

  const userCols = ['full_name', 'email', 'phone', 'role', 'status', 'birth_date', 'note'];
  const sets = [];
  const params = [];
  for (const col of userCols) {
    if (data[col] !== undefined) {
      params.push(data[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }

  const user = await withTransaction(async (client) => {
    let updated;
    if (sets.length) {
      params.push(targetId);
      const { rows } = await client.query(
        `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params,
      );
      updated = rows[0];
    } else {
      const { rows } = await client.query('SELECT * FROM users WHERE id = $1', [targetId]);
      updated = rows[0];
    }
    if (!updated) throw ApiError.notFound('ไม่พบผู้ใช้งานนี้');

    // ซิงก์ตารางช่างตัดผมให้ตรงกับ role
    const { rows: barberRows } = await client.query('SELECT id FROM barbers WHERE user_id = $1', [targetId]);
    if (updated.role === 'barber') {
      if (barberRows[0]) {
        await client.query(
          `UPDATE barbers SET nickname = COALESCE($1, nickname),
                              specialty = COALESCE($2, specialty),
                              code = COALESCE($3, code)
            WHERE user_id = $4`,
          [data.nickname ?? null, data.specialty ?? null, data.barber_code ?? null, targetId],
        );
      } else {
        await client.query(
          `INSERT INTO barbers (user_id, code, nickname, specialty, status, hired_at)
           VALUES ($1, $2, $3, $4, 'off', CURRENT_DATE)`,
          [targetId, data.barber_code || `BB-${String(targetId).padStart(2, '0')}`,
            data.nickname ?? null, data.specialty ?? null],
        );
      }
    }
    return updated;
  });

  delete user.password_hash;
  res.json({ user });
});

/** DELETE /api/users/:id */
export const deleteUser = asyncHandler(async (req, res) => {
  const targetId = Number(req.params.id);
  if (targetId === req.user.id) throw ApiError.badRequest('ไม่สามารถลบบัญชีของตนเองได้');

  const { rows: active } = await query(
    `SELECT 1 FROM queue_tickets
      WHERE customer_id = $1 AND status IN ('waiting','called','serving') LIMIT 1`,
    [targetId],
  );
  if (active.length) throw ApiError.conflict('ผู้ใช้นี้มีคิวที่ยังไม่เสร็จสิ้น กรุณาปิดคิวก่อนลบ');

  const { rowCount } = await query('DELETE FROM users WHERE id = $1', [targetId]);
  if (!rowCount) throw ApiError.notFound('ไม่พบผู้ใช้งานนี้');
  res.json({ message: 'ลบข้อมูลผู้ใช้เรียบร้อยแล้ว' });
});

/** PUT /api/users/me — จัดการข้อมูลส่วนตัว */
export const updateProfile = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', min: 2, max: 150, label: 'ชื่อ-นามสกุล' },
    phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    birth_date: { type: 'date', label: 'วันเกิด' },
    avatar_url: { type: 'string', max: 500, label: 'รูปโปรไฟล์' },
    notify_near_turn: { type: 'bool' },
    notify_my_turn: { type: 'bool' },
    notify_cancel: { type: 'bool' },
  });

  const cols = ['full_name', 'phone', 'birth_date', 'avatar_url', 'notify_near_turn', 'notify_my_turn', 'notify_cancel'];
  const sets = [];
  const params = [];
  for (const col of cols) {
    if (data[col] !== undefined) {
      params.push(data[col]);
      sets.push(`${col} = $${params.length}`);
    }
  }
  if (!sets.length) throw ApiError.badRequest('ไม่มีข้อมูลที่ต้องการแก้ไข');

  params.push(req.user.id);
  const { rows } = await query(
    `UPDATE users SET ${sets.join(', ')} WHERE id = $${params.length}
     RETURNING id, full_name, email, phone, role, status, avatar_url, birth_date,
               notify_near_turn, notify_my_turn, notify_cancel`,
    params,
  );
  res.json({ user: rows[0] });
});

/** POST /api/users/:id/reset-password — แอดมินตั้งรหัสผ่านใหม่ให้ผู้ใช้ */
export const adminSetPassword = asyncHandler(async (req, res) => {
  const password = req.body?.new_password;
  if (!password || password.length < 6) throw ApiError.badRequest('รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร');

  const { rowCount } = await query('UPDATE users SET password_hash = $1 WHERE id = $2',
    [await bcrypt.hash(password, 10), req.params.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบผู้ใช้งานนี้');

  await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.params.id]);
  res.json({ message: 'ตั้งรหัสผ่านใหม่ให้ผู้ใช้เรียบร้อยแล้ว' });
});
