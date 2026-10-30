/**
 * LINE Messaging API + LINE Login (LIFF)
 * เรียก REST API ตรง ๆ ด้วย fetch จึงไม่ต้องติดตั้ง SDK เพิ่ม
 *
 * ต้องตั้งค่าใน backend/.env
 *   LINE_CHANNEL_ACCESS_TOKEN, LINE_CHANNEL_SECRET   (Messaging API channel)
 *   LINE_LOGIN_CHANNEL_ID, LIFF_ID                   (LINE Login channel ที่มี LIFF app)
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

const API = 'https://api.line.me/v2/bot';

export const lineEnabled = () => !!config.line.channelAccessToken;
export const liffEnabled = () => !!(config.line.liffId && config.line.loginChannelId);

/** ลิงก์เปิดหน้าในแอปผ่าน LIFF (ถ้ายังไม่ตั้ง LIFF ใช้ลิงก์เว็บปกติ) */
export function appUrl(path = '/app/my-queue') {
  if (config.line.liffId) return `https://liff.line.me/${config.line.liffId}?to=${encodeURIComponent(path)}`;
  return `${config.publicUrl}${path}`;
}

export const addFriendUrl = () =>
  (config.line.botBasicId ? `https://line.me/R/ti/p/${encodeURIComponent(config.line.botBasicId)}` : null);

async function call(path, body) {
  const res = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${config.line.channelAccessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => '');
    throw new Error(`LINE API ${path} ${res.status}: ${text.slice(0, 300)}`);
  }
  return res.json().catch(() => ({}));
}

/** ส่งข้อความหาผู้ใช้ (push) — ใช้โควตาข้อความของ OA */
export async function pushMessage(to, messages) {
  if (!lineEnabled() || !to) return null;
  return call('/message/push', { to, messages: [].concat(messages).slice(0, 5) });
}

/** ตอบกลับข้อความ (reply) — ไม่เสียโควตา */
export async function replyMessage(replyToken, messages) {
  if (!lineEnabled() || !replyToken) return null;
  return call('/message/reply', { replyToken, messages: [].concat(messages).slice(0, 5) });
}

/** โปรไฟล์ผู้ใช้จาก LINE (ใช้ตอนผูกบัญชีผ่าน QR) */
export async function getProfile(lineUserId) {
  if (!lineEnabled() || !lineUserId) return null;
  const res = await fetch(`${API}/profile/${encodeURIComponent(lineUserId)}`, {
    headers: { Authorization: `Bearer ${config.line.channelAccessToken}` },
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) return null;
  return res.json().catch(() => null);
}

/** ตรวจลายเซ็น webhook: base64(HMAC-SHA256(channelSecret, rawBody)) */
export function verifySignature(rawBody, signature) {
  if (!config.line.channelSecret || !signature) return false;
  const expected = crypto.createHmac('sha256', config.line.channelSecret).update(rawBody).digest();
  const given = Buffer.from(String(signature), 'base64');
  return given.length === expected.length && crypto.timingSafeEqual(given, expected);
}

/**
 * ตรวจ ID token ที่ได้จาก liff.getIDToken() กับเซิร์ฟเวอร์ LINE
 * คืนค่า { sub (LINE userId), name, picture, email? }
 */
export async function verifyIdToken(idToken) {
  if (!config.line.loginChannelId) throw new Error('ยังไม่ได้ตั้งค่า LINE_LOGIN_CHANNEL_ID');
  const res = await fetch('https://api.line.me/oauth2/v2.1/verify', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ id_token: idToken, client_id: config.line.loginChannelId }),
    signal: AbortSignal.timeout(10_000),
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok || !json.sub) {
    const err = new Error(json.error_description || 'ยืนยันตัวตนกับ LINE ไม่สำเร็จ');
    err.status = 401;
    throw err;
  }
  return json;
}
