/**
 * สร้างเมนูด้านล่างห้องแชท (Rich menu) ของ LINE OA แล้วตั้งเป็นเมนูหลัก
 * เมนู 6 ปุ่ม (2 แถว x 3 คอลัมน์):
 *   รับบัตรคิว (เปิด LIFF) · คิวของฉัน · คิวตอนนี้
 *   จองล่วงหน้า · บริการ/ราคา · แต้มของฉัน
 *
 * สร้างรูปก่อนด้วย:  node scripts/line-richmenu-image.js
 *
 *   npm run line:richmenu
 * ต้องตั้ง LINE_CHANNEL_ACCESS_TOKEN และ LIFF_ID ใน .env ก่อน
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { config } from '../src/config.js';
import { appUrl } from '../src/utils/line.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const token = config.line.channelAccessToken;

async function api(url, { method = 'POST', body, contentType = 'application/json' } = {}) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': contentType } : {}) },
    body: body && contentType === 'application/json' ? JSON.stringify(body) : body,
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${text}`);
  return text ? JSON.parse(text) : {};
}

async function run() {
  if (!token) throw new Error('ยังไม่ได้ตั้ง LINE_CHANNEL_ACCESS_TOKEN ใน backend/.env');
  if (!config.line.liffId) console.warn('! ยังไม่ได้ตั้ง LIFF_ID ปุ่ม "รับบัตรคิว" จะเปิดเว็บปกติแทน');

  const W = 2500; const H = 1686; const CW = Math.floor(W / 3); const CH = Math.floor(H / 2);
  const cell = (i) => ({
    x: (i % 3) * CW,
    y: Math.floor(i / 3) * CH,
    width: i % 3 === 2 ? W - CW * 2 : CW,
    height: Math.floor(i / 3) === 1 ? H - CH : CH,
  });

  // ต้องเรียงให้ตรงกับรูปที่สร้างจาก scripts/line-richmenu-image.js
  const actions = [
    { type: 'uri', label: 'รับบัตรคิว', uri: appUrl('/app/take-queue') },
    { type: 'message', label: 'คิวของฉัน', text: 'คิวของฉัน' },
    { type: 'message', label: 'คิวตอนนี้', text: 'คิวตอนนี้' },
    { type: 'message', label: 'จองล่วงหน้า', text: 'จองคิว' },
    { type: 'message', label: 'บริการ/ราคา', text: 'ราคา' },
    { type: 'message', label: 'แต้มของฉัน', text: 'แต้มของฉัน' },
  ];

  const menu = {
    size: { width: W, height: H },
    selected: true,
    name: 'Trim & Co. main menu',
    chatBarText: 'เมนูร้าน',
    areas: actions.map((action, i) => ({ bounds: cell(i), action })),
  };

  // ลบเมนูเก่าที่สคริปต์นี้เคยสร้างไว้
  const { richmenus = [] } = await api('https://api.line.me/v2/bot/richmenu/list', { method: 'GET' });
  for (const m of richmenus.filter((r) => r.name === menu.name)) {
    await api(`https://api.line.me/v2/bot/richmenu/${m.richMenuId}`, { method: 'DELETE' });
    console.log(`• ลบเมนูเก่า ${m.richMenuId}`);
  }

  const { richMenuId } = await api('https://api.line.me/v2/bot/richmenu', { body: menu });
  console.log(`• สร้างเมนู ${richMenuId}`);

  const image = await fs.readFile(path.resolve(__dirname, '../assets/richmenu.png'));
  await api(`https://api-data.line.me/v2/bot/richmenu/${richMenuId}/content`, { body: image, contentType: 'image/png' });
  console.log('• อัปโหลดรูปเมนูแล้ว');

  await api(`https://api.line.me/v2/bot/user/all/richmenu/${richMenuId}`);
  console.log('✓ ตั้งเป็นเมนูหลักของ OA เรียบร้อย (ปิดแล้วเปิดห้องแชทใหม่เพื่อดูเมนู)');
}

run().catch((err) => {
  console.error('✗', err.message);
  process.exit(1);
});
