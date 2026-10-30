/**
 * สร้างรูปเมนูด้านล่างห้องแชท LINE (rich menu) ขนาด 2500 x 1686 — ธีมดำ-เงินโครเมียมตามโลโก้ร้าน 6 ช่อง
 * วาดเป็น SVG แล้วแปลงเป็น PNG ด้วย sharp จึงแก้ข้อความ/สีได้จากที่นี่ที่เดียว
 * ตำแหน่งช่องอยู่ใน scripts/richmenu-layout.js (ใช้ร่วมกับสคริปต์อัปโหลด)
 *
 * โลโก้ร้านอ่านจาก assets/logo.png (ตัวอักษรขาว พื้นโปร่งใส) วางมุมขวาล่างของช่องจองคิว
 *
 *   node scripts/line-richmenu-image.js        -> เขียนทับ assets/richmenu.png
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { W, H, CELLS } from './richmenu-layout.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const FONT = 'Leelawadee UI, Segoe UI, Tahoma, sans-serif';
const METAL_DARK = '#111113';
const METAL_PALE = '#D4D4D8';

/* ---- ไอคอนโลหะเงินแบบเติมสี ขนาด 100x100 (เส้นสีเข้มใช้ METAL_DARK) ---- */
const ICONS = {
  // บัตรคิวมีรอยปรุ
  ticket: `<path d="M10 26h80v14a10 10 0 0 0 0 20v14H10V60a10 10 0 0 0 0-20z" fill="url(#metal)" stroke="${METAL_DARK}" stroke-width="2"/>
           <path d="M64 30v8M64 46v8M64 62v8" stroke="${METAL_DARK}" stroke-width="4" stroke-linecap="round"/>
           <path d="M24 42h28M24 52h20M24 62h24" stroke="${METAL_DARK}" stroke-width="5" stroke-linecap="round"/>`,
  // กระดานรายชื่อคิว
  board: `<rect x="18" y="14" width="64" height="76" rx="9" fill="url(#metal)" stroke="${METAL_DARK}" stroke-width="2"/>
          <rect x="36" y="8" width="28" height="14" rx="5" fill="url(#metalDeep)" stroke="${METAL_DARK}" stroke-width="2"/>
          <circle cx="32" cy="40" r="4.5" fill="${METAL_DARK}"/><path d="M42 40h26" stroke="${METAL_DARK}" stroke-width="5" stroke-linecap="round"/>
          <circle cx="32" cy="56" r="4.5" fill="${METAL_DARK}"/><path d="M42 56h26" stroke="${METAL_DARK}" stroke-width="5" stroke-linecap="round"/>
          <circle cx="32" cy="72" r="4.5" fill="${METAL_DARK}"/><path d="M42 72h18" stroke="${METAL_DARK}" stroke-width="5" stroke-linecap="round"/>`,
  // ฟองแชทมีหูโทรศัพท์
  contact: `<path d="M50 10c24 0 42 15 42 34S74 78 50 78c-5 0-10-.6-14-1.8L16 88l6-17C13 64 8 55 8 44 8 25 26 10 50 10z" fill="url(#metal)" stroke="${METAL_DARK}" stroke-width="2"/>
            <path d="M37 28c3-1 5 0 6 2l3 7c1 2 0 4-1 5l-3 3c2 5 6 9 11 11l3-3c1-1 3-2 5-1l7 3c2 1 3 3 2 6-1 4-5 7-9 6-15-2-27-14-29-29-1-4 2-8 5-10z" fill="${METAL_DARK}"/>`,
  // ปฏิทินมีกรรไกร
  book: `<rect x="10" y="18" width="80" height="72" rx="12" fill="url(#metal)" stroke="${METAL_DARK}" stroke-width="2"/>
         <path d="M10 30a12 12 0 0 1 12-12h56a12 12 0 0 1 12 12v8H10z" fill="url(#metalDeep)"/>
         <rect x="26" y="8" width="9" height="20" rx="4" fill="url(#metalDeep)" stroke="${METAL_DARK}" stroke-width="2"/>
         <rect x="65" y="8" width="9" height="20" rx="4" fill="url(#metalDeep)" stroke="${METAL_DARK}" stroke-width="2"/>
         <g stroke="${METAL_DARK}" stroke-width="4.5" stroke-linecap="round" fill="none">
           <circle cx="38" cy="73" r="7"/><circle cx="62" cy="73" r="7"/>
           <path d="M43 68l20-22M57 68L37 46"/>
         </g>`,
  // เหรียญซ้อนมีดาว
  points: `<g stroke="${METAL_DARK}" stroke-width="2">
             <ellipse cx="38" cy="80" rx="26" ry="9" fill="url(#metalDeep)"/>
             <ellipse cx="38" cy="72" rx="26" ry="9" fill="url(#metal)"/>
             <ellipse cx="38" cy="64" rx="26" ry="9" fill="url(#metalDeep)"/>
             <ellipse cx="38" cy="56" rx="26" ry="9" fill="url(#metal)"/>
             <circle cx="64" cy="40" r="28" fill="url(#metal)"/>
             <circle cx="64" cy="40" r="21" fill="none" stroke-width="3"/>
           </g>
           <path d="M64 25l4.6 9.4 10.4 1.5-7.5 7.3 1.8 10.3-9.3-4.9-9.3 4.9 1.8-10.3-7.5-7.3 10.4-1.5z" fill="${METAL_DARK}"/>`,
  // คนมีเครื่องหมายบวก (วาดบนพื้นเงิน จึงใช้สีเข้มเป็นหลัก)
  register: `<circle cx="40" cy="30" r="17" fill="${METAL_DARK}"/>
             <path d="M8 88c0-20 14-34 32-34s32 14 32 34z" fill="${METAL_DARK}"/>
             <circle cx="74" cy="66" r="20" fill="#FFFFFF" stroke="${METAL_DARK}" stroke-width="5"/>
             <path d="M74 56v20M64 66h20" stroke="${METAL_DARK}" stroke-width="6" stroke-linecap="round"/>`,
};

const SMALL = [
  { cell: 'myQueue', icon: 'ticket', label: 'คิวของฉัน', sub: 'เหลืออีกกี่คิว' },
  { cell: 'shopQueue', icon: 'board', label: 'รายการคิว', sub: 'คิวหน้าร้านตอนนี้' },
  { cell: 'contact', icon: 'contact', label: 'ติดต่อร้าน', sub: 'โทร · แผนที่ · แอดมิน' },
];
// ช่องเตี้ยด้านขวาล่าง วางไอคอนซ้าย ข้อความขวา
const COMPACT = [
  { cell: 'points', icon: 'points', label: 'แต้มสะสม', sub: 'เช็กแต้ม · สิทธิ์สมาชิก' },
  { cell: 'register', icon: 'register', label: 'สมัครสมาชิก', sub: 'ฟรี! สะสมแต้มทุกครั้ง', accent: true },
];
const BIG = { cell: 'book', icon: 'book', label: 'จองคิว & บริการ', sub: 'เลือกบริการ · ช่าง · รับคิวได้ทันที', cta: 'กดจองเลย' };

const PAD = 20; // ระยะขอบกรอบโลหะจากเส้นแบ่งช่อง

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const DEFS = `
  <defs>
    <linearGradient id="metal" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset=".42" stop-color="#E4E4E7"/><stop offset=".52" stop-color="#8E8E96"/>
      <stop offset=".75" stop-color="#C9C9CF"/><stop offset="1" stop-color="#5A5A62"/>
    </linearGradient>
    <linearGradient id="metalDeep" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#B8B8BF"/><stop offset="1" stop-color="#3A3A40"/>
    </linearGradient>
    <linearGradient id="metalText" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset=".45" stop-color="#E4E4E7"/><stop offset=".56" stop-color="#9A9AA2"/><stop offset="1" stop-color="#F4F4F5"/>
    </linearGradient>
    <linearGradient id="frame" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="#FFFFFF"/><stop offset=".25" stop-color="#6B6B72"/>
      <stop offset=".5" stop-color="#E4E4E7"/><stop offset=".75" stop-color="#4A4A50"/><stop offset="1" stop-color="#F4F4F5"/>
    </linearGradient>
    <linearGradient id="panel" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#1C1C1F"/><stop offset="1" stop-color="#060606"/>
    </linearGradient>
    <radialGradient id="shine" cx=".5" cy=".38" r=".6">
      <stop offset="0" stop-color="#E4E4E7" stop-opacity=".22"/><stop offset="1" stop-color="#E4E4E7" stop-opacity="0"/>
    </radialGradient>
    <pattern id="hatch" width="36" height="36" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
      <path d="M0 0v36" stroke="#E4E4E7" stroke-opacity=".05" stroke-width="2"/>
    </pattern>
    <filter id="glow" x="-10%" y="-10%" width="120%" height="120%">
      <feGaussianBlur stdDeviation="14"/>
    </filter>
    <filter id="shadow" x="-20%" y="-20%" width="140%" height="140%">
      <feGaussianBlur in="SourceAlpha" stdDeviation="6"/><feOffset dy="6"/>
      <feComponentTransfer><feFuncA type="linear" slope=".85"/></feComponentTransfer>
      <feMerge><feMergeNode/><feMergeNode in="SourceGraphic"/></feMerge>
    </filter>
  </defs>`;

/** กรอบเงินเรืองแสงของแต่ละช่อง */
function frame({ x, y, width, height }) {
  const fx = x + PAD; const fy = y + PAD; const fw = width - PAD * 2; const fh = height - PAD * 2;
  return `
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="none" stroke="#E4E4E7" stroke-opacity=".55" stroke-width="10" filter="url(#glow)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="url(#panel)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="url(#hatch)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="url(#shine)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="none" stroke="url(#frame)" stroke-width="7"/>
    <rect x="${fx + 16}" y="${fy + 16}" width="${fw - 32}" height="${fh - 32}" rx="20" fill="none" stroke="#E4E4E7" stroke-opacity=".28" stroke-width="2"/>`;
}

const icon = (name, x, y, size) =>
  `<g transform="translate(${x} ${y}) scale(${size / 100})" filter="url(#shadow)">${ICONS[name]}</g>`;

/** ประกายดาว 4 แฉก */
const sparkle = (x, y, r, o = 1) =>
  `<path d="M${x} ${y - r}Q${x + r * 0.18} ${y - r * 0.18} ${x + r} ${y}Q${x + r * 0.18} ${y + r * 0.18} ${x} ${y + r}Q${x - r * 0.18} ${y + r * 0.18} ${x - r} ${y}Q${x - r * 0.18} ${y - r * 0.18} ${x} ${y - r}z" fill="#FFFFFF" opacity="${o}"/>`;

function smallTile(btn) {
  const c = CELLS[btn.cell];
  const cx = c.x + c.width / 2;
  const size = 290;
  return `
  <g>
    ${frame(c)}
    ${icon(btn.icon, cx - size / 2, c.y + 120, size)}
    <text x="${cx}" y="${c.y + 575}" text-anchor="middle" font-family="${FONT}" font-size="100" font-weight="bold"
          fill="url(#metalText)" filter="url(#shadow)">${esc(btn.label)}</text>
    <text x="${cx}" y="${c.y + 665}" text-anchor="middle" font-family="${FONT}" font-size="46"
          fill="${METAL_PALE}" fill-opacity=".8">${esc(btn.sub)}</text>
  </g>`;
}

/** ช่องสีเงินทึบ (ปุ่มเด่น) */
function metalFrame({ x, y, width, height }) {
  const fx = x + PAD; const fy = y + PAD; const fw = width - PAD * 2; const fh = height - PAD * 2;
  return `
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="none" stroke="#E4E4E7" stroke-opacity=".7" stroke-width="12" filter="url(#glow)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="url(#metal)"/>
    <rect x="${fx}" y="${fy}" width="${fw}" height="${fh}" rx="30" fill="none" stroke="#FFFFFF" stroke-width="5"/>
    <rect x="${fx + 14}" y="${fy + 14}" width="${fw - 28}" height="${fh - 28}" rx="20" fill="none" stroke="${METAL_DARK}" stroke-opacity=".35" stroke-width="2"/>`;
}

function compactTile(btn) {
  const c = CELLS[btn.cell];
  const size = 180;
  const ix = c.x + 62;
  const tx = ix + size + 34;
  const labelFill = btn.accent ? METAL_DARK : 'url(#metalText)';
  const subFill = btn.accent ? METAL_DARK : METAL_PALE;
  return `
  <g>
    ${btn.accent ? metalFrame(c) : frame(c)}
    <g transform="translate(${ix} ${c.y + (c.height - size) / 2}) scale(${size / 100})"${btn.accent ? '' : ' filter="url(#shadow)"'}>${ICONS[btn.icon]}</g>
    <text x="${tx}" y="${c.y + c.height / 2 + 10}" font-family="${FONT}" font-size="78" font-weight="bold"
          fill="${labelFill}"${btn.accent ? '' : ' filter="url(#shadow)"'}>${esc(btn.label)}</text>
    <text x="${tx}" y="${c.y + c.height / 2 + 72}" font-family="${FONT}" font-size="38"
          fill="${subFill}" fill-opacity=".85">${esc(btn.sub)}</text>
  </g>`;
}

function bigTile(btn) {
  const c = CELLS[btn.cell];
  const size = 420;
  const tx = c.x + 620;
  const pillW = 470; const pillH = 124; const pillY = c.y + 545;
  return `
  <g>
    ${frame(c)}
    <circle cx="${c.x + 330}" cy="${c.y + c.height / 2}" r="250" fill="url(#shine)"/>
    ${icon(btn.icon, c.x + 120, c.y + (c.height - size) / 2, size)}
    ${sparkle(c.x + 520, c.y + 190, 34)}${sparkle(c.x + 150, c.y + 640, 22, 0.8)}
    ${sparkle(c.x + c.width - 150, c.y + 170, 26, 0.9)}
    <text x="${tx}" y="${c.y + 360}" font-family="${FONT}" font-size="126" font-weight="bold"
          fill="url(#metalText)" filter="url(#shadow)">${esc(btn.label)}</text>
    <text x="${tx}" y="${c.y + 455}" font-family="${FONT}" font-size="52" fill="${METAL_PALE}" fill-opacity=".85">${esc(btn.sub)}</text>
    <g filter="url(#shadow)">
      <rect x="${tx}" y="${pillY}" width="${pillW}" height="${pillH}" rx="${pillH / 2}" fill="url(#metal)" stroke="#FFFFFF" stroke-opacity=".7" stroke-width="3"/>
      <text x="${tx + pillW / 2 - 24}" y="${pillY + 82}" text-anchor="middle" font-family="${FONT}" font-size="60" font-weight="bold" fill="${METAL_DARK}">${esc(btn.cta)}</text>
      <path d="M${tx + pillW - 92} ${pillY + 40}l22 22-22 22" fill="none" stroke="${METAL_DARK}" stroke-width="10" stroke-linecap="round" stroke-linejoin="round"/>
    </g>
  </g>`;
}

function buildSvg(logo) {
  const b = CELLS[BIG.cell];
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" viewBox="0 0 ${W} ${H}">
    ${DEFS}
    <rect width="${W}" height="${H}" fill="#030303"/>
    ${SMALL.map(smallTile).join('')}
    ${COMPACT.map(compactTile).join('')}
    ${bigTile(BIG)}
    <image href="data:image/png;base64,${logo.data}" x="${b.x + b.width - 80 - LOGO_W}" y="${b.y + b.height - 50 - logo.height}"
           width="${LOGO_W}" height="${logo.height}" filter="url(#shadow)"/>
  </svg>`;
}

const out = path.resolve(__dirname, '../assets/richmenu.png');
const LOGO = path.resolve(__dirname, '../assets/logo.png');
const LOGO_W = 480;

try {
  const { data, info } = await sharp(LOGO).resize({ width: LOGO_W }).png().toBuffer({ resolveWithObject: true });
  const logo = { data: data.toString('base64'), height: info.height };

  // LINE รับรูป rich menu ไม่เกิน 1 MB จึงลดเป็น PNG แบบ palette
  const png = await sharp(Buffer.from(buildSvg(logo))).png({ compressionLevel: 9, palette: true, quality: 90 }).toBuffer();
  if (png.length > 1024 * 1024) throw new Error(`รูปใหญ่ ${(png.length / 1024).toFixed(0)} KB เกินขีดจำกัด 1 MB ของ LINE`);
  await fs.writeFile(out, png);

  console.log(`✓ สร้างรูปเมนูแล้ว: ${out}`);
  console.log(`  ${W}x${H} · ${(png.length / 1024).toFixed(0)} KB · ${SMALL.length + COMPACT.length + 1} ปุ่ม`);
  console.log('  ขั้นต่อไป: npm run line:richmenu เพื่ออัปโหลดขึ้น LINE OA');
} catch (err) {
  console.error('✗ สร้างรูปเมนูไม่สำเร็จ:', err.message);
  process.exitCode = 1;
}
