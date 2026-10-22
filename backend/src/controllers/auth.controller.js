/**
 * Module: Authentication
 *  Login / Logout / Change Password / Forgot Password / Create Password
 */
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import crypto from 'node:crypto';
import { config } from '../config.js';
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate, assertStrongPassword } from '../utils/validate.js';

const sha256 = (v) => crypto.createHash('sha256').update(v).digest('hex');

const signAccessToken = (user) =>
  jwt.sign({ sub: user.id, role: user.role }, config.jwt.secret, { expiresIn: config.jwt.expiresIn });

const publicUser = (u) => ({
  id: u.id,
  full_name: u.full_name,
  email: u.email,
  phone: u.phone,
  role: u.role,
  status: u.status,
  avatar_url: u.avatar_url,
  barber_id: u.barber_id ?? null,
  line_linked: !!u.line_user_id,
  line_display_name: u.line_display_name ?? null,
});

/** POST /api/auth/register — สมัครสมาชิก (ลูกค้า) */
export const register = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    full_name: { type: 'string', required: true, min: 2, max: 150, label: 'ชื่อ-นามสกุล' },
    email: { type: 'email', required: true, label: 'อีเมล' },
    phone: { type: 'phone', required: true, label: 'เบอร์โทรศัพท์' },
  });
  assertStrongPassword(req.body.password);

  const hash = await bcrypt.hash(req.body.password, 10);
  const { rows } = await query(
    `INSERT INTO users (full_name, email, phone, password_hash, role)
     VALUES ($1, $2, $3, $4, 'customer')
     RETURNING *`,
    [data.full_name, data.email, data.phone, hash],
  );

  const user = rows[0];
  res.status(201).json({ token: signAccessToken(user), user: publicUser(user) });
});

/** POST /api/auth/login */
export const login = asyncHandler(async (req, res) => {
  const data = validate(req.body, { email: { type: 'email', required: true, label: 'อีเมล' } });
  if (!req.body.password) throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', { password: 'กรุณากรอกรหัสผ่าน' });

  const { rows } = await query(
    `SELECT u.*, b.id AS barber_id
       FROM users u LEFT JOIN barbers b ON b.user_id = u.id
      WHERE u.email = $1`,
    [data.email],
  );
  const user = rows[0];

  // ข้อความเดียวกันทั้งกรณีอีเมลผิดและรหัสผ่านผิด เพื่อไม่ให้เดาว่ามีอีเมลนี้ในระบบ
  const invalid = ApiError.unauthorized('อีเมลหรือรหัสผ่านไม่ถูกต้อง');
  if (!user || !user.password_hash) throw invalid;
  if (!(await bcrypt.compare(req.body.password, user.password_hash))) throw invalid;
  if (user.status !== 'active') throw ApiError.forbidden('บัญชีนี้ถูกระงับการใช้งาน');

  const refreshToken = crypto.randomBytes(48).toString('hex');
  await query(
    `INSERT INTO refresh_tokens (user_id, token_hash, user_agent, ip_address, expires_at)
     VALUES ($1, $2, $3, $4, NOW() + ($5 || ' days')::INTERVAL)`,
    [user.id, sha256(refreshToken), req.headers['user-agent'] || null, req.ip, String(config.jwt.refreshDays)],
  );
  await query('UPDATE users SET last_login_at = NOW() WHERE id = $1', [user.id]);

  res.json({ token: signAccessToken(user), refresh_token: refreshToken, user: publicUser(user) });
});

/** POST /api/auth/refresh — ขอ access token ใหม่ */
export const refresh = asyncHandler(async (req, res) => {
  const token = req.body?.refresh_token;
  if (!token) throw ApiError.unauthorized('ไม่พบ refresh token');

  const { rows } = await query(
    `SELECT rt.id, u.*, b.id AS barber_id
       FROM refresh_tokens rt
       JOIN users u   ON u.id = rt.user_id
       LEFT JOIN barbers b ON b.user_id = u.id
      WHERE rt.token_hash = $1 AND rt.revoked_at IS NULL AND rt.expires_at > NOW()`,
    [sha256(token)],
  );
  const user = rows[0];
  if (!user) throw ApiError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');

  res.json({ token: signAccessToken(user), user: publicUser(user) });
});

/** POST /api/auth/logout */
export const logout = asyncHandler(async (req, res) => {
  if (req.body?.refresh_token) {
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE token_hash = $1', [sha256(req.body.refresh_token)]);
  } else if (req.user) {
    // ไม่ได้ส่ง refresh token มา -> เพิกถอนทุกเซสชันของผู้ใช้คนนี้
    await query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  }
  res.json({ message: 'ออกจากระบบเรียบร้อย' });
});

/** GET /api/auth/me */
export const me = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT u.*, b.id AS barber_id FROM users u
     LEFT JOIN barbers b ON b.user_id = u.id WHERE u.id = $1`,
    [req.user.id],
  );
  const u = rows[0];
  res.json({
    user: {
      ...publicUser(u),
      notify_near_turn: u.notify_near_turn,
      notify_my_turn: u.notify_my_turn,
      notify_cancel: u.notify_cancel,
    },
  });
});

/** POST /api/auth/change-password */
export const changePassword = asyncHandler(async (req, res) => {
  const { current_password: current, new_password: next } = req.body || {};
  if (!current) throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', { current_password: 'กรุณากรอกรหัสผ่านปัจจุบัน' });
  assertStrongPassword(next);
  if (current === next) throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', { new_password: 'รหัสผ่านใหม่ต้องไม่ซ้ำกับรหัสผ่านเดิม' });

  const { rows } = await query('SELECT password_hash FROM users WHERE id = $1', [req.user.id]);
  const hash = rows[0]?.password_hash;
  if (!hash || !(await bcrypt.compare(current, hash))) {
    throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', { current_password: 'รหัสผ่านปัจจุบันไม่ถูกต้อง' });
  }

  await withTransaction(async (client) => {
    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 10), req.user.id]);
    // เปลี่ยนรหัสผ่านแล้วให้ทุกเซสชันเดิมหลุด
    await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [req.user.id]);
  });

  res.json({ message: 'เปลี่ยนรหัสผ่านเรียบร้อยแล้ว' });
});

/** POST /api/auth/forgot-password — ขอลิงก์ตั้งรหัสผ่านใหม่ */
export const forgotPassword = asyncHandler(async (req, res) => {
  const { email } = validate(req.body, { email: { type: 'email', required: true, label: 'อีเมล' } });
  const { rows } = await query('SELECT id, password_hash FROM users WHERE email = $1 AND status = $2', [email, 'active']);
  const user = rows[0];

  // ตอบข้อความเดียวกันเสมอ ไม่เปิดเผยว่ามีอีเมลนี้ในระบบหรือไม่
  const response = { message: 'หากอีเมลนี้อยู่ในระบบ เราได้ส่งลิงก์สำหรับตั้งรหัสผ่านใหม่ไปให้แล้ว' };

  if (user) {
    const token = crypto.randomBytes(32).toString('hex');
    await query(
      `INSERT INTO password_resets (user_id, token_hash, purpose, expires_at)
       VALUES ($1, $2, $3, NOW() + INTERVAL '1 hour')`,
      [user.id, sha256(token), user.password_hash ? 'reset' : 'create'],
    );
    const link = `${config.publicUrl}/reset-password?token=${token}`;
    // ยังไม่ได้ต่อบริการอีเมลจริง -> log ลิงก์ไว้ให้ทดสอบ และส่งกลับเฉพาะตอน dev
    console.log(`[auth] reset link for user ${user.id}: ${link}`);
    if (config.env !== 'production') response.reset_link = link;
  }

  res.json(response);
});

/** POST /api/auth/reset-password — ตั้งรหัสผ่านใหม่ / Create Password ครั้งแรก */
export const resetPassword = asyncHandler(async (req, res) => {
  const { token, new_password: next } = req.body || {};
  if (!token) throw ApiError.badRequest('ลิงก์ไม่ถูกต้อง');
  assertStrongPassword(next);

  await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, user_id FROM password_resets
        WHERE token_hash = $1 AND used_at IS NULL AND expires_at > NOW()
        FOR UPDATE`,
      [sha256(token)],
    );
    const reset = rows[0];
    if (!reset) throw ApiError.badRequest('ลิงก์หมดอายุหรือถูกใช้ไปแล้ว');

    await client.query('UPDATE users SET password_hash = $1 WHERE id = $2', [await bcrypt.hash(next, 10), reset.user_id]);
    await client.query('UPDATE password_resets SET used_at = NOW() WHERE id = $1', [reset.id]);
    await client.query('UPDATE refresh_tokens SET revoked_at = NOW() WHERE user_id = $1 AND revoked_at IS NULL', [reset.user_id]);
  });

  res.json({ message: 'ตั้งรหัสผ่านใหม่เรียบร้อยแล้ว กรุณาเข้าสู่ระบบอีกครั้ง' });
});
