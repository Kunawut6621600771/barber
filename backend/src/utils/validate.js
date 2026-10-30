import { ApiError } from './http.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PHONE_RE = /^[0-9+\-() ]{6,20}$/;

/**
 * ตรวจสอบ body แบบง่าย ๆ ตาม schema ที่กำหนด
 * schema: { field: { type, required, min, max, enum, label } }
 * คืนค่า object ที่ผ่านการ trim/แปลงชนิดแล้ว
 */
export function validate(body, schema) {
  const out = {};
  const errors = {};

  for (const [field, rule] of Object.entries(schema)) {
    const label = rule.label || field;
    let value = body?.[field];

    if (value === undefined || value === null || value === '') {
      if (rule.required) errors[field] = `กรุณากรอก${label}`;
      else if (rule.default !== undefined) out[field] = rule.default;
      continue;
    }

    switch (rule.type) {
      case 'string':
        value = String(value).trim();
        if (rule.min && value.length < rule.min) errors[field] = `${label}ต้องมีอย่างน้อย ${rule.min} ตัวอักษร`;
        if (rule.max && value.length > rule.max) errors[field] = `${label}ต้องไม่เกิน ${rule.max} ตัวอักษร`;
        break;
      case 'email':
        value = String(value).trim().toLowerCase();
        if (!EMAIL_RE.test(value)) errors[field] = 'รูปแบบอีเมลไม่ถูกต้อง';
        break;
      case 'phone':
        value = String(value).trim();
        if (!PHONE_RE.test(value)) errors[field] = 'รูปแบบเบอร์โทรศัพท์ไม่ถูกต้อง';
        break;
      case 'int':
        value = Number(value);
        if (!Number.isInteger(value)) errors[field] = `${label}ต้องเป็นจำนวนเต็ม`;
        else if (rule.min !== undefined && value < rule.min) errors[field] = `${label}ต้องไม่น้อยกว่า ${rule.min}`;
        else if (rule.max !== undefined && value > rule.max) errors[field] = `${label}ต้องไม่เกิน ${rule.max}`;
        break;
      case 'number':
        value = Number(value);
        if (!Number.isFinite(value)) errors[field] = `${label}ต้องเป็นตัวเลข`;
        else if (rule.min !== undefined && value < rule.min) errors[field] = `${label}ต้องไม่น้อยกว่า ${rule.min}`;
        break;
      case 'bool':
        value = value === true || value === 'true' || value === 1 || value === '1';
        break;
      case 'enum':
        value = String(value);
        if (!rule.enum.includes(value)) errors[field] = `${label}ไม่ถูกต้อง (${rule.enum.join(', ')})`;
        break;
      case 'date':
        if (!isRealDate(value)) errors[field] = `${label}ไม่ถูกต้อง`;
        else value = String(value).slice(0, 10);
        break;
      default:
        break;
    }
    out[field] = value;
  }

  if (Object.keys(errors).length) throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', errors);
  return out;
}

/** วันที่ขึ้นต้นด้วย YYYY-MM-DD ที่มีอยู่จริงในปฏิทิน (2026-02-30 = ไม่ผ่าน) */
export function isRealDate(value) {
  const s = String(value ?? '');
  if (!/^\d{4}-\d{2}-\d{2}([T ].*)?$/.test(s) || Number.isNaN(Date.parse(s))) return false;
  const ymd = s.slice(0, 10);
  return new Date(`${ymd}T00:00:00Z`).toISOString().slice(0, 10) === ymd;
}

/** ตรวจความแข็งแรงของรหัสผ่าน */
export function assertStrongPassword(password) {
  if (typeof password !== 'string' || password.length < 6) {
    throw ApiError.badRequest('ข้อมูลไม่ถูกต้อง', { password: 'รหัสผ่านต้องมีอย่างน้อย 6 ตัวอักษร' });
  }
}
