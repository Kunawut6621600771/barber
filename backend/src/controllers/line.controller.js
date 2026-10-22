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
import { query, shopToday } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import {
  lineEnabled, liffEnabled, verifySignature, verifyIdToken, replyMessage,
  queueCard, quickReply, appUrl, addFriendUrl,
} from '../utils/line.js';

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
/* ------------------------------------------------------------------ */

async function myQueueMessage(lineUserId) {
  const { rows: users } = await query('SELECT id, full_name FROM users WHERE line_user_id = $1', [lineUserId]);
  const user = users[0];
  if (!user) {
    return queueCard({
      title: 'ยังไม่ได้เชื่อมบัญชี',
      message: 'เปิดแอปของร้านเพื่อเข้าสู่ระบบด้วย LINE แล้วระบบจะแจ้งเตือนคิวให้คุณที่นี่',
      buttonLabel: 'เปิดแอป / รับบัตรคิว',
      path: '/app/take-queue',
    });
  }

  const { rows } = await query(
    `SELECT * FROM v_queue_board
      WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called','serving')
      ORDER BY seq LIMIT 1`,
    [user.id, shopToday()],
  );
  const t = rows[0];
  if (!t) {
    return queueCard({
      title: 'คุณยังไม่มีคิววันนี้',
      message: 'กดปุ่มด้านล่างเพื่อเลือกบริการ ชำระเงิน และรับบัตรคิวได้ทันที',
      buttonLabel: 'รับบัตรคิว',
      path: '/app/take-queue',
    });
  }

  const { rows: ahead } = await query(
    `SELECT COUNT(*)::int AS n FROM queue_tickets
      WHERE queue_date = $1 AND status = 'waiting' AND position < $2`,
    [t.queue_date, t.position ?? 0],
  );
  const { rows: est } = await query('SELECT estimate_wait_minutes($1,$2) AS mins', [t.queue_date, t.position ?? 1]);

  const statusText = { waiting: 'รอคิว', called: 'ถึงคิวแล้ว! เชิญที่เคาน์เตอร์', serving: 'กำลังให้บริการ' }[t.status];
  return queueCard({
    title: statusText,
    ticketNo: t.ticket_no,
    tone: t.status === 'called' ? 'danger' : 'brand',
    rows: [
      ['บริการ', t.service_name],
      ...(t.status === 'waiting' ? [['เหลืออีก', `${ahead[0].n} คิว`], ['รอประมาณ', `${est[0].mins} นาที`]] : []),
      ...(t.barber_name ? [['ช่าง', t.barber_name]] : []),
    ],
  });
}

async function shopStatusMessage() {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status='waiting')::int AS waiting,
            (SELECT ticket_no FROM queue_tickets WHERE queue_date=$1 AND status='serving' ORDER BY started_at DESC LIMIT 1) AS serving,
            (SELECT ticket_no FROM queue_tickets WHERE queue_date=$1 AND status='called' ORDER BY called_at DESC LIMIT 1) AS called
       FROM queue_tickets WHERE queue_date = $1`,
    [shopToday()],
  );
  const s = rows[0];
  return queueCard({
    title: 'สถานะคิวหน้าร้านตอนนี้',
    rows: [
      ['กำลังเรียก', s.called || '—'],
      ['กำลังให้บริการ', s.serving || '—'],
      ['คิวที่รออยู่', `${s.waiting} คิว`],
    ],
    buttonLabel: 'รับบัตรคิว',
    path: '/app/take-queue',
  });
}

const helpMessage = () => ({
  type: 'text',
  text: 'สวัสดีครับ 💈 พิมพ์หรือกดเมนูด้านล่างได้เลย\n• "คิวของฉัน" ดูสถานะคิว\n• "คิวตอนนี้" ดูคิวหน้าร้าน\n• "รับคิว" เปิดแอปเพื่อรับบัตรคิว',
  quickReply: quickReply(),
});

async function handleEvent(event) {
  const userId = event.source?.userId;

  if (event.type === 'follow') {
    return replyMessage(event.replyToken, [
      queueCard({
        title: 'ยินดีต้อนรับสู่ Trim & Co.',
        message: 'รับบัตรคิว จ่ายผ่าน QR และรับแจ้งเตือนเมื่อใกล้ถึงคิวได้ในแชทนี้ กดปุ่มด้านล่างเพื่อเริ่มใช้งาน',
        buttonLabel: 'เปิดแอป / รับบัตรคิว',
        path: '/app/take-queue',
      }),
      helpMessage(),
    ]);
  }

  if (event.type === 'unfollow' && userId) {
    // บล็อก OA แล้วส่งข้อความไม่ได้ -> เลิกผูกไว้ก่อน
    await query('UPDATE users SET line_user_id = NULL, line_linked_at = NULL WHERE line_user_id = $1', [userId]);
    return null;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text.trim().toLowerCase();
    let msg;
    if (/คิวของฉัน|คิวฉัน|สถานะ|my ?queue/.test(text)) msg = await myQueueMessage(userId);
    else if (/คิวตอนนี้|หน้าร้าน|now/.test(text)) msg = await shopStatusMessage();
    else if (/รับคิว|จองคิว|รับบัตร|book/.test(text)) {
      msg = queueCard({
        title: 'รับบัตรคิวออนไลน์',
        message: 'เลือกบริการ สแกนจ่ายด้วย QR PromptPay แล้วรับบัตรคิวได้ทันที',
        buttonLabel: 'รับบัตรคิว',
        path: '/app/take-queue',
      });
    } else return replyMessage(event.replyToken, helpMessage());
    return replyMessage(event.replyToken, { ...msg, quickReply: quickReply() });
  }

  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback?.data || '');
    if (data.get('action') === 'my_queue') return replyMessage(event.replyToken, await myQueueMessage(userId));
    if (data.get('action') === 'shop') return replyMessage(event.replyToken, await shopStatusMessage());
  }
  return null;
}

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

export { appUrl };
