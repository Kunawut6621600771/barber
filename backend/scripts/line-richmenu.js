/**
 * สร้างเมนูด้านล่างห้องแชท (Rich menu) ของ LINE OA แล้วตั้งเป็นเมนูหลัก
 * เมนู 6 ช่อง ธีมดำ-เงินโครเมียม (ผังอยู่ใน scripts/richmenu-layout.js):
 *   คิวของฉัน · รายการคิว · ติดต่อร้าน
 *   จองคิวและบริการ (ช่องใหญ่ เปิด LIFF) · แต้มสะสม / สมัครสมาชิก (เปิด LIFF)
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
import { W, H, CELLS } from './richmenu-layout.js';

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
  if (!config.line.liffId) console.warn('! ยังไม่ได้ตั้ง LIFF_ID ปุ่ม "จองคิวและบริการ" จะเปิดเว็บปกติแทน');

  // ช่องเดียวกับที่ใช้วาดรูปใน scripts/line-richmenu-image.js
  const areas = [
    { bounds: CELLS.myQueue, action: { type: 'message', label: 'คิวของฉัน', text: 'คิวของฉัน' } },
    { bounds: CELLS.shopQueue, action: { type: 'message', label: 'รายการคิว', text: 'คิวตอนนี้' } },
    { bounds: CELLS.contact, action: { type: 'message', label: 'ติดต่อร้าน', text: 'ติดต่อร้าน' } },
    { bounds: CELLS.book, action: { type: 'uri', label: 'จองคิวและบริการ', uri: appUrl('/app/take-queue') } },
    { bounds: CELLS.points, action: { type: 'message', label: 'แต้มสะสม', text: 'แต้มของฉัน' } },
    // ผ่าน LIFF: ลูกค้าใหม่จะได้ปุ่ม "เริ่มใช้งานด้วยบัญชี LINE" (สร้างบัญชีสมาชิก) แล้วไปกรอกเบอร์/วันเกิดต่อ
    { bounds: CELLS.register, action: { type: 'uri', label: 'สมัครสมาชิก', uri: appUrl('/app/profile') } },
  ];

  const menu = {
    size: { width: W, height: H },
    selected: true,
    name: 'Trim & Co. main menu',
    chatBarText: 'เมนูร้าน',
    areas,
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
