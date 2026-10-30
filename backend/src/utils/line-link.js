/**
 * ผูกบัญชี LINE ด้วยการสแกน QR
 *
 * ปัญหาเดิม: ลูกค้าต้องเปิดแอปจากใน LINE (LIFF) ถึงจะผูกบัญชีได้
 * วิธีนี้: สร้างรหัสชั่วคราวผูกกับผู้ใช้ที่ล็อกอินอยู่ แล้วทำเป็น QR
 *          ลูกค้าสแกนด้วยมือถือ -> LINE เปิดห้องแชทของร้านพร้อมข้อความที่มีรหัส
 *          -> กดส่ง -> webhook จับรหัสแล้วผูก line_user_id ให้อัตโนมัติ
 *
 * ใช้ได้แม้ลูกค้าเปิดเว็บอยู่บนคอมพิวเตอร์หรือแท็บเล็ตของร้าน
 */
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { query } from '../db.js';

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';   // ตัด I, O, 0, 1 ออกกันอ่านผิด
const TTL_MINUTES = 30;

/** ข้อความที่ลูกค้าจะส่งให้บอท — webhook ใช้ regex นี้จับรหัส */
export const LINK_RE = /LINK-([A-Z0-9]{6})/i;
export const linkMessage = (code) => `เชื่อมบัญชีคิว ${code}`;

const newCode = () => {
  const bytes = crypto.randomBytes(6);
  return `LINK-${Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('')}`;
};

/**
 * ลิงก์เปิดห้องแชทของร้านพร้อมข้อความที่พิมพ์ไว้ให้แล้ว
 * (ถ้ายังไม่ได้เป็นเพื่อนกัน LINE จะชวนเพิ่มเพื่อนให้ก่อน)
 */
export function oaMessageUrl(code) {
  const id = config.line.botBasicId;
  if (!id) return null;
  return `https://line.me/R/oaMessage/${encodeURIComponent(id)}/?${encodeURIComponent(linkMessage(code))}`;
}

/**
 * รหัสผูกบัญชีที่ยังใช้ได้ของผู้ใช้คนนี้ ถ้าไม่มีก็สร้างใหม่
 * ใช้รหัสเดิมซ้ำได้ภายในอายุ เพื่อไม่ให้ QR เปลี่ยนไปมาตอนหน้าจอรีเฟรช
 */
export async function issueLinkCode(userId, ticketId = null) {
  const { rows: existing } = await query(
    `SELECT code, expires_at FROM line_link_tokens
      WHERE user_id = $1 AND used_at IS NULL AND expires_at > NOW() + INTERVAL '2 minutes'
      ORDER BY created_at DESC LIMIT 1`,
    [userId],
  );
  if (existing[0]) return existing[0];

  // กันรหัสชนกัน (โอกาสน้อยมาก แต่ลองใหม่ได้ถูกกว่าปล่อยให้ error)
  for (let attempt = 0; attempt < 5; attempt += 1) {
    const code = newCode();
    const { rows } = await query(
      `INSERT INTO line_link_tokens (code, user_id, ticket_id, expires_at)
       VALUES ($1, $2, $3, NOW() + ($4 || ' minutes')::INTERVAL)
       ON CONFLICT (code) DO NOTHING
       RETURNING code, expires_at`,
      [code, userId, ticketId, String(TTL_MINUTES)],
    );
    if (rows[0]) return rows[0];
  }
  throw new Error('สร้างรหัสเชื่อมบัญชีไม่สำเร็จ');
}

/** ข้อมูลครบชุดที่หน้าเว็บต้องใช้วาดการ์ด QR */
export async function linkQrPayload(userId, ticketId = null) {
  const { code, expires_at: expiresAt } = await issueLinkCode(userId, ticketId);
  const url = oaMessageUrl(code);

  return {
    code,
    expires_at: expiresAt,
    url,
    message: linkMessage(code),
    qr_code: url ? await QRCode.toDataURL(url, { width: 320, margin: 1 }) : null,
  };
}

/**
 * ใช้รหัสผูกบัญชี — เรียกจาก webhook เมื่อลูกค้าส่งข้อความที่มีรหัส
 * @returns {Promise<{ok: true, user} | {ok: false, reason: string}>}
 */
export async function redeemLinkCode(code, profile) {
  const { rows } = await query(
    `SELECT t.*, u.full_name, u.line_user_id
       FROM line_link_tokens t JOIN users u ON u.id = t.user_id
      WHERE UPPER(t.code) = UPPER($1)`,
    [code],
  );
  const token = rows[0];

  if (!token) return { ok: false, reason: 'not_found' };
  if (token.used_at) return { ok: false, reason: 'used' };
  if (new Date(token.expires_at) < new Date()) return { ok: false, reason: 'expired' };

  // บัญชี LINE นี้ผูกกับผู้ใช้คนอื่นอยู่แล้ว
  const { rows: other } = await query(
    'SELECT id FROM users WHERE line_user_id = $1 AND id <> $2', [profile.userId, token.user_id],
  );
  if (other.length) return { ok: false, reason: 'line_taken' };

  // จองรหัสแบบ atomic ก่อน กันสองบัญชี LINE ใช้รหัสเดียวกันพร้อมกัน
  const { rowCount: claimed } = await query(
    `UPDATE line_link_tokens SET used_at = NOW(), used_by = $2
      WHERE code = $1 AND used_at IS NULL AND expires_at > NOW()`,
    [token.code, profile.userId],
  );
  if (!claimed) return { ok: false, reason: 'used' };

  const { rows: updated } = await query(
    `UPDATE users
        SET line_user_id = $2, line_display_name = $3, line_picture_url = $4, line_linked_at = NOW()
      WHERE id = $1
      RETURNING id, full_name, line_display_name`,
    [token.user_id, profile.userId, profile.displayName || null, profile.pictureUrl || null],
  );

  return { ok: true, user: updated[0], ticketId: token.ticket_id };
}
