/**
 * Module: LINE Official Account (Bot) + LIFF
 *
 *   GET  /api/line/config        ค่าที่หน้าเว็บ/LIFF ต้องใช้ (public)
 *   POST /api/line/webhook       รับ event จาก LINE (ตรวจลายเซ็นทุกครั้ง)
 *   POST /api/auth/line          เข้าสู่ระบบด้วย LINE จากใน LIFF (id_token)
 *   POST /api/line/link          ผูกบัญชีที่ล็อกอินอยู่กับ LINE
 *   DELETE /api/line/link        ยกเลิกการผูก
 */
import crypto from 'node:crypto';
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import {
  lineEnabled, liffEnabled, verifySignature, verifyIdToken, appUrl, addFriendUrl, pushMessage,
} from '../utils/line.js';
import { handleEvent } from '../utils/line-bot.js';
import { linkQrPayload } from '../utils/line-link.js';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

/* ------------------------------------------------------------------ */
/*  config                                                            */
/* ------------------------------------------------------------------ */

export const lineConfig = asyncHandler(async (_req, res) => {
  res.json({
    liff_id: config.line.liffId || null,
    liff_enabled: liffEnabled(),
    bot_enabled: lineEnabled(),
    add_friend_url: addFriendUrl(),
  });
});

/* ------------------------------------------------------------------ */
/*  LIFF login / link                                                 */
/* ------------------------------------------------------------------ */

const publicUser = (u) => ({
  id: u.id, full_name: u.full_name, email: u.email, phone: u.phone, role: u.role,
  status: u.status, avatar_url: u.avatar_url, barber_id: u.barber_id ?? null,
  line_linked: !!u.line_user_id, line_display_name: u.line_display_name ?? null,
});

async function issueSession(req, user) {
  const refreshToken = crypto.randomBytes(48).toString('hex');
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::INTERVAL)`,
    [user.id, sha256(refreshToken), req.headers['user-agent'] || null, req.ip, String(config.jwt.refreshDays)],
  );
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);
  return {
    token: jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn }),
    refresh_token: refreshToken,
    user: publicUser(user),
  };
}

async function profileFromToken(idToken) {
  if (!liffEnabled()) throw ApiError.badRequest('ร้านยังไม่ได้ตั้งค่า LINE Login / LIFF');
  if (!idToken) throw ApiError.badRequest('ไม่พบ id_token จาก LINE');
  try {
    return await verifyIdToken(idToken);
  } catch (err) {
    throw ApiError.unauthorized(err.message || 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
  }
}

/**
 * POST /api/auth/line  { id_token, create?: boolean }
 *  - ผูกไว้แล้ว -> เข้าสู่ระบบ
 *  - ยังไม่ผูก + create=true -> สร้างบัญชีลูกค้าใหม่จากโปรไฟล์ LINE แล้วเข้าสู่ระบบ
 *  - ยังไม่ผูก + create=false -> 404 { code: 'not_linked' } ให้หน้าเว็บถามลูกค้าว่าจะทำอะไร
 */
export const loginWithLine = asyncHandler(async (req, res) => {
  const profile = await profileFromToken(req.body?.id_token);

  const { rows } = await query(
    `SELECT u.*, b.id AS barber_id FROM users u LEFT JOIN barbers b ON b.user_id = u.id
      WHERE u.line_user_id = $1`,
    [profile.sub],
  );
  let user = rows[0];

  if (!user) {
    if (!req.body?.create) {
      return res.status(404).json({
        error: 'บัญชี LINE นี้ยังไม่ได้เชื่อมกับระบบ',
        details: { code: 'not_linked', name: profile.name || null, picture: profile.picture || null },
      });
    }
    // อีเมลจาก LINE (ถ้าขอสิทธิ์ไว้) ถ้าซ้ำกับบัญชีเดิม ไม่ผูกให้อัตโนมัติ ให้ลูกค้าล็อกอินเพื่อยืนยันเอง
    let email = profile.email ? String(profile.email).toLowerCase() : null;
    if (email) {
      const { rows: dup } = await query('SELECT 1 FROM users WHERE email = $1', [email]);
      if (dup.length) {
        throw ApiError.conflict('อีเมลของ LINE นี้มีบัญชีในระบบอยู่แล้ว กรุณาเลือก "เข้าสู่ระบบบัญชีเดิม" เพื่อเชื่อม LINE');
      }
    }
    email ??= `line_${profile.sub.toLowerCase()}@line.local`;

    const { rows: created } = await query(
      `INSERT INTO users (full_name, email, role, avatar_url, line_user_id, line_display_name, line_picture_url, line_linked_at)
       VALUES ($1, $2, 'customer', $3, $4, $5, $3, NOW())
       RETURNING *`,
      [(profile.name || 'ลูกค้า LINE').slice(0, 150), email, profile.picture || null, profile.sub, profile.name || null],
    );
    user = created[0];
  } else {
    await query(
      `UPDATE users SET line_display_name = $2, line_picture_url = $3 WHERE id = $1`,
      [user.id, profile.name || null, profile.picture || null],
    );
  }

  if (user.status !== 'active') throw ApiError.forbidden('บัญชีนี้ถูกระงับการใช้งาน');
  res.json(await issueSession(req, user));
});

/** POST /api/line/link  { id_token } — ผู้ใช้ที่ล็อกอินอยู่ เชื่อมกับ LINE */
export const linkLine = asyncHandler(async (req, res) => {
  const profile = await profileFromToken(req.body?.id_token);

  const { rows: other } = await query(
    'SELECT id FROM users WHERE line_user_id = $1 AND id <> $2', [profile.sub, req.user.id],
  );
  if (other.length) throw ApiError.conflict('บัญชี LINE นี้เชื่อมกับผู้ใช้อื่นอยู่แล้ว');

  await query(
    `UPDATE users SET line_user_id = $2, line_display_name = $3, line_picture_url = $4, line_linked_at = NOW()
      WHERE id = $1`,
    [req.user.id, profile.sub, profile.name || null, profile.picture || null],
  );
  res.json({ message: 'เชื่อมต่อ LINE เรียบร้อยแล้ว ระบบจะแจ้งเตือนคิวผ่าน LINE', line_display_name: profile.name || null });
});

/** DELETE /api/line/link */
export const unlinkLine = asyncHandler(async (req, res) => {
  await query(
    `UPDATE users SET line_user_id = NULL, line_display_name = NULL, line_picture_url = NULL, line_linked_at = NULL
      WHERE id = $1`,
    [req.user.id],
  );
  res.json({ message: 'ยกเลิกการเชื่อมต่อ LINE แล้ว' });
});

/**
 * GET /api/line/link-qr?ticket_id= — QR สำหรับสแกนผูกบัญชี LINE
 *
 * ลูกค้าสแกนด้วยมือถือ -> LINE เปิดห้องแชทร้านพร้อมข้อความที่มีรหัส -> กดส่ง -> ผูกให้อัตโนมัติ
 * หน้าเว็บเรียกซ้ำเป็นระยะเพื่อเช็กว่าผูกสำเร็จหรือยัง (ดูค่า linked)
 */
export const linkQr = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT line_user_id, line_display_name, line_picture_url FROM users WHERE id = $1', [req.user.id],
  );
  const u = rows[0] || {};

  if (u.line_user_id) {
    return res.json({
      linked: true,
      display_name: u.line_display_name || null,
      picture_url: u.line_picture_url || null,
    });
  }

  if (!lineEnabled()) {
    return res.json({ linked: false, available: false, reason: 'ร้านยังไม่ได้ตั้งค่า LINE Official Account' });
  }
  if (!config.line.botBasicId) {
    return res.json({ linked: false, available: false, reason: 'ร้านยังไม่ได้ตั้งค่า LINE_BOT_BASIC_ID' });
  }

  const ticketId = req.query.ticket_id ? Number(req.query.ticket_id) : null;
  const payload = await linkQrPayload(req.user.id, Number.isInteger(ticketId) ? ticketId : null);

  return res.json({
    linked: false,
    available: true,
    add_friend_url: addFriendUrl(),
    ...payload,
  });
});

/** GET /api/line/me — สถานะการเชื่อม LINE ของฉัน */
export const myLine = asyncHandler(async (req, res) => {
  const { rows } = await query(
    'SELECT line_user_id, line_display_name, line_picture_url, line_linked_at FROM users WHERE id = $1',
    [req.user.id],
  );
  const u = rows[0] || {};
  res.json({
    linked: !!u.line_user_id,
    display_name: u.line_display_name || null,
    picture_url: u.line_picture_url || null,
    linked_at: u.line_linked_at || null,
  });
});

/* ------------------------------------------------------------------ */
/*  Webhook                                                           */
/*  ตรรกะการตอบลูกค้าอยู่ใน utils/line-bot.js                           */
/* ------------------------------------------------------------------ */

/** POST /api/line/webhook — ต้องได้ raw body (ตั้งไว้ใน server.js) */
export async function webhook(req, res) {
  const raw = Buffer.isBuffer(req.body) ? req.body : Buffer.from('');
  if (!verifySignature(raw, req.headers['x-line-signature'])) {
    return res.status(401).json({ error: 'invalid signature' });
  }

  let body;
  try {
    body = JSON.parse(raw.toString('utf8'));
  } catch {
    return res.status(400).json({ error: 'invalid body' });
  }

  // ตอบ 200 ทันที (LINE ต้องการคำตอบภายในไม่กี่วินาที) แล้วค่อยประมวลผล
  res.status(200).json({ ok: true });
  for (const event of body.events || []) {
    handleEvent(event).catch((err) => console.error('[line webhook]', err.message));
  }
  return undefined;
}

/* ------------------------------------------------------------------ */
/*  ประวัติแชท (ให้แอดมินตามอ่านในเว็บ)                                 */
/* ------------------------------------------------------------------ */

/** GET /api/line/messages?line_user_id= — ข้อความล่าสุดจากลูกค้า */
export const listLineMessages = asyncHandler(async (req, res) => {
  const params = [];
  let where = '';
  if (req.query.line_user_id) {
    params.push(req.query.line_user_id);
    where = `WHERE m.line_user_id = $${params.length}`;
  }

  const { rows } = await query(
    `SELECT m.*, u.full_name, u.line_display_name
       FROM line_messages m LEFT JOIN users u ON u.id = m.user_id
      ${where}
      ORDER BY m.created_at DESC LIMIT 200`,
    params,
  );
  res.json({ data: rows.reverse() });
});

/** GET /api/line/threads — ลูกค้าที่คุยกับบอทล่าสุด */
export const listLineThreads = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT DISTINCT ON (m.line_user_id)
            m.line_user_id, m.created_at AS last_at, m.text AS last_text, m.intent,
            u.id AS user_id, u.full_name, u.line_display_name, u.line_picture_url
       FROM line_messages m LEFT JOIN users u ON u.id = m.user_id
      WHERE m.line_user_id IS NOT NULL AND m.direction = 'in'
      ORDER BY m.line_user_id, m.created_at DESC`,
  );
  rows.sort((a, b) => new Date(b.last_at) - new Date(a.last_at));
  res.json({ data: rows.slice(0, 100) });
});

/** POST /api/line/push — พนักงานส่งข้อความหาลูกค้าทาง LINE */
export const pushToCustomer = asyncHandler(async (req, res) => {
  const text = String(req.body?.text || '').trim();
  const target = String(req.body?.line_user_id || '').trim();

  if (!text) throw ApiError.badRequest('กรุณาพิมพ์ข้อความ');
  if (!target) throw ApiError.badRequest('ไม่พบผู้รับ');
  if (!lineEnabled()) throw ApiError.badRequest('ร้านยังไม่ได้ตั้งค่า LINE Messaging API');

  await pushMessage(target, { type: 'text', text: text.slice(0, 1800) });
  await query(
    `INSERT INTO line_messages (line_user_id, user_id, direction, intent, text)
     VALUES ($1, (SELECT id FROM users WHERE line_user_id = $1), 'out', 'staff_reply', $2)`,
    [target, text.slice(0, 2000)],
  );

  res.json({ message: 'ส่งข้อความถึงลูกค้าแล้ว' });
});

export { appUrl };
