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

/* ------------------------------------------------------------------ */
/*  ข้อความสำเร็จรูป (Flex Message)                                    */
/* ------------------------------------------------------------------ */

const COLORS = { brand: '#DC2626', ink: '#111827', muted: '#6B7280', ok: '#15803D', danger: '#B91C1C' };

const row = (label, value) => ({
  type: 'box', layout: 'horizontal', spacing: 'md',
  contents: [
    { type: 'text', text: label, size: 'sm', color: COLORS.muted, flex: 2 },
    { type: 'text', text: String(value ?? '—'), size: 'sm', color: COLORS.ink, flex: 3, align: 'end', wrap: true },
  ],
});

/**
 * การ์ดแจ้งเตือนเรื่องคิว
 * @param {{ title, message, ticketNo?, rows?: [label, value][], tone?, buttonLabel?, path? }} p
 */
export function queueCard({ title, message, ticketNo, rows = [], tone = 'brand', buttonLabel = 'เปิดดูคิวของฉัน', path = '/app/my-queue' }) {
  const header = [
    { type: 'text', text: 'Trim & Co.', size: 'xs', color: '#FFFFFFCC', weight: 'bold' },
    { type: 'text', text: title, size: 'lg', color: '#FFFFFF', weight: 'bold', wrap: true, margin: 'sm' },
  ];
  const body = [];
  if (ticketNo) {
    body.push({ type: 'text', text: 'หมายเลขคิว', size: 'xs', color: COLORS.muted, align: 'center' });
    body.push({ type: 'text', text: ticketNo, size: '4xl', weight: 'bold', color: COLORS.ink, align: 'center' });
  }
  if (message) body.push({ type: 'text', text: message, size: 'sm', color: COLORS.ink, wrap: true, margin: 'md' });
  if (rows.length) {
    body.push({ type: 'separator', margin: 'lg' });
    body.push({ type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg', contents: rows.map(([l, v]) => row(l, v)) });
  }

  return {
    type: 'flex',
    altText: `${title}${ticketNo ? ` — คิว ${ticketNo}` : ''}${message ? `: ${message}` : ''}`.slice(0, 390),
    contents: {
      type: 'bubble',
      header: { type: 'box', layout: 'vertical', backgroundColor: COLORS[tone] || COLORS.brand, paddingAll: '16px', contents: header },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body },
      footer: {
        type: 'box', layout: 'vertical',
        contents: [{
          type: 'button', style: 'primary', color: COLORS.ink, height: 'sm',
          action: { type: 'uri', label: buttonLabel, uri: appUrl(path) },
        }],
      },
    },
  };
}

/** เมนูลัดใต้ข้อความ (quick reply) */
export const quickReply = () => ({
  items: [
    { type: 'action', action: { type: 'uri', label: 'รับบัตรคิว', uri: appUrl('/app/take-queue') } },
    { type: 'action', action: { type: 'message', label: 'คิวของฉัน', text: 'คิวของฉัน' } },
    { type: 'action', action: { type: 'message', label: 'คิวตอนนี้', text: 'คิวตอนนี้' } },
  ],
});
