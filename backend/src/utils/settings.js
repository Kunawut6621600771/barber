/**
 * ค่าคอนฟิกร้านที่เก็บในตาราง shop_settings
 * อ่านบ่อยมาก (ทุกบิล ทุกข้อความ LINE) จึง cache ไว้สั้น ๆ แล้วล้างเมื่อมีการบันทึก
 */
import { query } from '../db.js';

const TTL_MS = 30_000;
let cache = null;
let cachedAt = 0;

/** ค่าเริ่มต้น ใช้เมื่อยังไม่มีคีย์นั้นในฐานข้อมูล */
export const DEFAULTS = {
  shop_name: 'Trim & Co.',
  shop_tagline: 'Classic cuts, modern care.',
  shop_phone: '',
  shop_address: '',
  shop_map_url: '',
  ticket_prefix: 'B',
  near_turn_threshold: '2',
  open_time: '09:00',
  close_time: '20:00',
  open_days: 'จันทร์ - อาทิตย์',
  tax_rate: '0',
  tax_id: '',
  receipt_footer: 'ขอบคุณที่ใช้บริการ',
  points_per_baht: '0.05',
  point_value_baht: '1',
  min_points_redeem: '50',
  loyalty_enabled: 'true',
  booking_enabled: 'true',
  booking_slot_min: '30',
  booking_max_days: '14',
};

/** ล้าง cache (เรียกหลังบันทึกค่าตั้งค่า) */
export function invalidateSettings() {
  cache = null;
  cachedAt = 0;
}

/** อ่านค่าตั้งค่าทั้งหมดเป็น object { key: value } */
export async function getSettings(client = null) {
  if (cache && Date.now() - cachedAt < TTL_MS) return cache;

  const run = client ? client.query.bind(client) : query;
  const { rows } = await run('SELECT key, value FROM shop_settings');

  const map = { ...DEFAULTS };
  for (const r of rows) map[r.key] = r.value;

  cache = map;
  cachedAt = Date.now();
  return map;
}

export const num = (v, fallback = 0) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
};

export const bool = (v, fallback = false) =>
  (v === undefined || v === null || v === '' ? fallback : String(v) === 'true');

/** กลุ่มค่าที่ระบบแต้มสะสมใช้ */
export async function loyaltyConfig(client = null) {
  const s = await getSettings(client);
  return {
    enabled: bool(s.loyalty_enabled, true),
    pointsPerBaht: num(s.points_per_baht, 0.05),
    pointValueBaht: num(s.point_value_baht, 1),
    minRedeem: num(s.min_points_redeem, 50),
  };
}

/** ข้อมูลร้านที่เปิดเผยต่อสาธารณะได้ (หน้าเว็บ / LINE bot ใช้) */
export async function publicShopInfo(client = null) {
  const s = await getSettings(client);
  return {
    shop_name: s.shop_name,
    tagline: s.shop_tagline,
    phone: s.shop_phone,
    address: s.shop_address,
    map_url: s.shop_map_url,
    open_time: s.open_time,
    close_time: s.close_time,
    open_days: s.open_days,
    booking_enabled: bool(s.booking_enabled, true),
    booking_max_days: num(s.booking_max_days, 14),
    loyalty_enabled: bool(s.loyalty_enabled, true),
    points_per_baht: num(s.points_per_baht, 0.05),
    point_value_baht: num(s.point_value_baht, 1),
    min_points_redeem: num(s.min_points_redeem, 50),
  };
}
