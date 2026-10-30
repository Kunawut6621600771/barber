/**
 * Module: ตั้งค่าร้าน
 *
 *   GET /api/settings/public   ข้อมูลร้านที่เปิดเผยได้ (ไม่ต้องล็อกอิน)
 *   GET /api/settings          ค่าตั้งค่าทั้งหมด (พนักงาน)
 *   PUT /api/settings          บันทึกหลายคีย์พร้อมกัน (แอดมิน)
 */
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { getSettings, invalidateSettings, publicShopInfo, DEFAULTS } from '../utils/settings.js';

/** คีย์ที่อนุญาตให้แก้ผ่าน API พร้อมกติกาตรวจค่า */
const EDITABLE = {
  shop_name: { label: 'ชื่อร้าน', max: 100, required: true },
  shop_tagline: { label: 'สโลแกน', max: 150 },
  shop_phone: { label: 'เบอร์โทรร้าน', max: 40 },
  shop_address: { label: 'ที่อยู่ร้าน', max: 300 },
  shop_map_url: { label: 'ลิงก์แผนที่', max: 500 },
  ticket_prefix: { label: 'ตัวอักษรนำหน้าเลขคิว', max: 4, pattern: /^[A-Za-z]{1,4}$/ },
  near_turn_threshold: { label: 'แจ้งเตือนเมื่อเหลืออีกกี่คิว', int: [1, 20] },
  open_time: { label: 'เวลาเปิดร้าน', pattern: /^([01]\d|2[0-3]):[0-5]\d$/ },
  close_time: { label: 'เวลาปิดร้าน', pattern: /^([01]\d|2[0-3]):[0-5]\d$/ },
  open_days: { label: 'วันเปิดทำการ', max: 100 },
  tax_rate: { label: 'อัตราภาษี', number: [0, 100] },
  tax_id: { label: 'เลขประจำตัวผู้เสียภาษี', max: 20 },
  receipt_footer: { label: 'ข้อความท้ายใบเสร็จ', max: 200 },
  points_per_baht: { label: 'แต้มต่อ 1 บาท', number: [0, 10] },
  point_value_baht: { label: 'มูลค่า 1 แต้ม', number: [0, 100] },
  min_points_redeem: { label: 'แต้มขั้นต่ำที่แลกได้', int: [0, 100000] },
  loyalty_enabled: { label: 'เปิดระบบสะสมแต้ม', bool: true },
  booking_enabled: { label: 'เปิดให้จองล่วงหน้า', bool: true },
  booking_slot_min: { label: 'ความถี่ช่วงเวลาจอง', int: [5, 240] },
  booking_max_days: { label: 'จองล่วงหน้าได้กี่วัน', int: [1, 90] },
};

export const getPublicSettings = asyncHandler(async (_req, res) => {
  res.json(await publicShopInfo());
});

export const listSettings = asyncHandler(async (_req, res) => {
  const values = await getSettings();
  const { rows } = await query('SELECT key, description FROM shop_settings');
  const descriptions = Object.fromEntries(rows.map((r) => [r.key, r.description]));

  res.json({
    settings: values,
    fields: Object.entries(EDITABLE).map(([key, rule]) => ({
      key,
      label: rule.label,
      description: descriptions[key] || null,
      type: rule.bool ? 'bool' : (rule.int || rule.number) ? 'number' : 'text',
      value: values[key] ?? DEFAULTS[key] ?? '',
    })),
  });
});

export const updateSettings = asyncHandler(async (req, res) => {
  const body = req.body?.settings ?? req.body ?? {};
  const entries = Object.entries(body).filter(([key]) => key in EDITABLE);
  if (!entries.length) throw ApiError.badRequest('ไม่มีค่าที่แก้ไขได้ในคำขอนี้');

  const errors = {};
  const clean = [];

  for (const [key, raw] of entries) {
    const rule = EDITABLE[key];
    let value = raw === null || raw === undefined ? '' : String(raw).trim();

    if (rule.bool) {
      value = (raw === true || value === 'true' || value === '1') ? 'true' : 'false';
    } else if (rule.int) {
      const n = Number(value);
      if (!Number.isInteger(n) || n < rule.int[0] || n > rule.int[1]) {
        errors[key] = `${rule.label}ต้องเป็นจำนวนเต็ม ${rule.int[0]}–${rule.int[1]}`;
      }
      value = String(n);
    } else if (rule.number) {
      const n = Number(value);
      if (!Number.isFinite(n) || n < rule.number[0] || n > rule.number[1]) {
        errors[key] = `${rule.label}ต้องเป็นตัวเลข ${rule.number[0]}–${rule.number[1]}`;
      }
      value = String(n);
    } else {
      if (rule.required && !value) errors[key] = `กรุณากรอก${rule.label}`;
      if (rule.max && value.length > rule.max) errors[key] = `${rule.label}ต้องไม่เกิน ${rule.max} ตัวอักษร`;
      if (rule.pattern && value && !rule.pattern.test(value)) errors[key] = `รูปแบบ${rule.label}ไม่ถูกต้อง`;
      if (key === 'ticket_prefix') value = value.toUpperCase();
    }

    clean.push([key, value]);
  }

  if (Object.keys(errors).length) throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', errors);

  await withTransaction(async (client) => {
    for (const [key, value] of clean) {
      await client.query(
        `INSERT INTO shop_settings (key, value, description) VALUES ($1,$2,$3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value`,
        [key, value, EDITABLE[key].label],
      );
    }
  });
  invalidateSettings();

  res.json({ settings: await getSettings(), message: 'บันทึกการตั้งค่าเรียบร้อยแล้ว' });
});
