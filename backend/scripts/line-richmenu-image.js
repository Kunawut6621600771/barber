/**
 * สร้างรูปเมนูด้านล่างห้องแชท LINE (rich menu) ขนาด 2500 x 1686 — 6 ปุ่ม
 * วาดเป็น SVG แล้วแปลงเป็น PNG ด้วย sharp จึงแก้ข้อความ/สีได้จากที่นี่ที่เดียว
 *
 *   node scripts/line-richmenu-image.js        -> เขียนทับ assets/richmenu.png
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { getSettings } from '../src/utils/settings.js';
import { pool } from '../src/db.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const W = 2500;
const H = 1686;
const COLS = 3;
const ROWS = 2;
const CW = Math.floor(W / COLS);      // 833
const CH = Math.floor(H / ROWS);      // 843

const INK = '#0B1220';
const INK_SOFT = '#151D2E';
const BRAND = '#DC2626';
const WHITE = '#FFFFFF';
const MUTED = '#8A93A5';
const FONT = 'Leelawadee UI, Segoe UI, Tahoma, sans-serif';

/** ไอคอนวาดด้วยเส้น (stroke) ขนาด 100x100 วางกลางช่อง */
const ICONS = {
  ticket: `<rect x="12" y="28" width="76" height="44" rx="8"/>
           <path d="M50 28v8M50 46v8M50 64v8"/>`,
  list: `<rect x="16" y="16" width="68" height="68" rx="10"/>
         <path d="M32 38h36M32 52h36M32 66h22"/>`,
  eye: `<path d="M8 50c14-20 28-30 42-30s28 10 42 30c-14 20-28 30-42 30S22 70 8 50z"/>
        <circle cx="50" cy="50" r="13"/>`,
  calendar: `<rect x="14" y="24" width="72" height="62" rx="10"/>
             <path d="M14 44h72M34 14v20M66 14v20"/>
             <circle cx="38" cy="60" r="4" fill="currentColor" stroke="none"/>
             <circle cx="62" cy="60" r="4" fill="currentColor" stroke="none"/>`,
  tag: `<path d="M52 12H86v34L46 86 12 52z"/>
        <circle cx="72" cy="27" r="6"/>`,
  star: `<path d="M50 12l12 25 27 4-20 19 5 27-24-13-24 13 5-27-20-19 27-4z"/>`,
};

const BUTTONS = [
  { icon: 'ticket', label: 'รับบัตรคิว', sub: 'เลือกบริการแล้วรับคิว', accent: true },
  { icon: 'list', label: 'คิวของฉัน', sub: 'เหลืออีกกี่คิว' },
  { icon: 'eye', label: 'คิวตอนนี้', sub: 'สถานะหน้าร้าน' },
  { icon: 'calendar', label: 'จองล่วงหน้า', sub: 'เลือกวันและเวลา' },
  { icon: 'tag', label: 'บริการ / ราคา', sub: 'ดูเมนูทั้งหมด' },
  { icon: 'star', label: 'แต้มของฉัน', sub: 'สิทธิ์สมาชิก' },
];

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

function tile(btn, col, row) {
  const x = col * CW;
  const y = row * CH;
  const cx = x + CW / 2;

  const bg = btn.accent ? BRAND : (col + row) % 2 === 0 ? INK : INK_SOFT;
  const iconColor = btn.accent ? WHITE : BRAND;
  const subColor = btn.accent ? '#FFFFFFB3' : MUTED;

  // ไอคอน 100x100 ขยาย 1.6 เท่า วางไว้ค่อนไปทางบนของช่อง
  const scale = 1.6;
  const iconX = cx - (100 * scale) / 2;
  const iconY = y + CH * 0.24;

  return `
  <g>
    <rect x="${x}" y="${y}" width="${CW}" height="${CH}" fill="${bg}"/>
    <g transform="translate(${iconX} ${iconY}) scale(${scale})"
       fill="none" stroke="${iconColor}" stroke-width="5"
       stroke-linecap="round" stroke-linejoin="round" color="${iconColor}">
      ${ICONS[btn.icon]}
    </g>
    <text x="${cx}" y="${y + CH * 0.72}" text-anchor="middle"
          font-family="${FONT}" font-size="62" font-weight="bold" fill="${WHITE}">${esc(btn.label)}</text>
    <text x="${cx}" y="${y + CH * 0.82}" text-anchor="middle"
          font-family="${FONT}" font-size="36" fill="${subColor}">${esc(btn.sub)}</text>
  </g>`;
}

function buildSvg(shopName) {
  const tiles = BUTTONS.map((b, i) => tile(b, i % COLS, Math.floor(i / COLS))).join('');

  // เส้นคั่นบาง ๆ ระหว่างช่อง
  const lines = [
    ...[1, 2].map((c) => `<line x1="${c * CW}" y1="0" x2="${c * CW}" y2="${H}" stroke="#FFFFFF1A" stroke-width="3"/>`),
    `<line x1="0" y1="${CH}" x2="${W}" y2="${CH}" stroke="#FFFFFF1A" stroke-width="3"/>`,
  ].join('');

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    <rect width="${W}" height="${H}" fill="${INK}"/>
    ${tiles}
    ${lines}
    <text x="${W - 30}" y="${H - 24}" text-anchor="end"
          font-family="${FONT}" font-size="30" fill="#FFFFFF4D">${esc(shopName)}</text>
  </svg>`;
}

const out = path.resolve(__dirname, '../assets/richmenu.png');

try {
  let shopName = 'Trim & Co.';
  try {
    shopName = (await getSettings()).shop_name;
  } catch {
    console.warn('! อ่านชื่อร้านจากฐานข้อมูลไม่ได้ ใช้ค่าเริ่มต้นแทน');
  }

  const png = await sharp(Buffer.from(buildSvg(shopName))).png({ compressionLevel: 9 }).toBuffer();
  await fs.writeFile(out, png);

  console.log(`✓ สร้างรูปเมนูแล้ว: ${out}`);
  console.log(`  ${W}x${H} · ${(png.length / 1024).toFixed(0)} KB · ${BUTTONS.length} ปุ่ม`);
  console.log('  ขั้นต่อไป: npm run line:richmenu เพื่ออัปโหลดขึ้น LINE OA');
} catch (err) {
  console.error('✗ สร้างรูปเมนูไม่สำเร็จ:', err.message);
  process.exitCode = 1;
} finally {
  await pool.end().catch(() => {});
}
