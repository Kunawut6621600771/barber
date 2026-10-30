import { test } from 'node:test';
import assert from 'node:assert/strict';
import { validate, isRealDate, assertStrongPassword } from '../../src/utils/validate.js';

/** เรียก validate แล้วคืน errors (ถ้าผ่านคืน null) */
const errorsOf = (body, schema) => {
  try { validate(body, schema); return null; } catch (e) { return e.details || e.errors || e; }
};

test('UT-VD-01 ช่องบังคับว่าง -> error "กรุณากรอก..."', () => {
  const err = errorsOf({ name: '' }, { name: { type: 'string', required: true, label: 'ชื่อ' } });
  assert.ok(err);
  assert.match(JSON.stringify(err), /กรุณากรอกชื่อ/);
});

test('UT-VD-02 ช่องไม่บังคับที่ว่าง ใช้ค่า default', () => {
  const out = validate({}, { qty: { type: 'int', default: 1 } });
  assert.equal(out.qty, 1);
});

test('UT-VD-03 string ถูก trim และตรวจความยาว min/max', () => {
  assert.equal(validate({ n: '  ab  ' }, { n: { type: 'string', min: 2 } }).n, 'ab');
  assert.ok(errorsOf({ n: 'a' }, { n: { type: 'string', min: 2 } }));
  assert.ok(errorsOf({ n: 'abcdef' }, { n: { type: 'string', max: 5 } }));
});

test('UT-VD-04 อีเมลแปลงเป็นตัวพิมพ์เล็ก และปฏิเสธรูปแบบผิด', () => {
  assert.equal(validate({ e: ' Admin@Trimco.LOCAL ' }, { e: { type: 'email' } }).e, 'admin@trimco.local');
  assert.ok(errorsOf({ e: 'not-an-email' }, { e: { type: 'email' } }));
});

test('UT-VD-05 เบอร์โทรรับตัวเลข/ขีด และปฏิเสธตัวอักษร', () => {
  assert.equal(validate({ p: '081-234-5678' }, { p: { type: 'phone' } }).p, '081-234-5678');
  assert.ok(errorsOf({ p: 'abc12' }, { p: { type: 'phone' } }));
});

test('UT-VD-06 int ปฏิเสธทศนิยมและค่านอกช่วง min/max', () => {
  assert.equal(validate({ q: '3' }, { q: { type: 'int', min: 1 } }).q, 3);
  assert.ok(errorsOf({ q: 1.5 }, { q: { type: 'int' } }));
  assert.ok(errorsOf({ q: 0 }, { q: { type: 'int', min: 1 } }));
  assert.ok(errorsOf({ q: 99 }, { q: { type: 'int', max: 10 } }));
});

test('UT-VD-07 number ปฏิเสธ Infinity / ตัวอักษร และค่าต่ำกว่า min', () => {
  assert.equal(validate({ a: '150.5' }, { a: { type: 'number', min: 0 } }).a, 150.5);
  assert.ok(errorsOf({ a: 'Infinity' }, { a: { type: 'number' } }));
  assert.ok(errorsOf({ a: 'abc' }, { a: { type: 'number' } }));
  assert.ok(errorsOf({ a: -1 }, { a: { type: 'number', min: 0 } }));
});

test('UT-VD-08 enum รับเฉพาะค่าที่กำหนด', () => {
  const s = { r: { type: 'enum', enum: ['admin', 'staff'] } };
  assert.equal(validate({ r: 'staff' }, s).r, 'staff');
  assert.ok(errorsOf({ r: 'root' }, s));
});

test('UT-VD-09 bool แปลง "true"/"1"/1 เป็น true และค่าอื่นเป็น false', () => {
  const s = { b: { type: 'bool' } };
  for (const v of [true, 'true', 1, '1']) assert.equal(validate({ b: v }, s).b, true);
  for (const v of [false, 'false', 0, 'no']) assert.equal(validate({ b: v }, s).b, false);
});

test('UT-VD-10 วันที่ต้องมีจริงในปฏิทิน (2026-02-30 ไม่ผ่าน, 2028-02-29 ผ่าน)', () => {
  assert.equal(isRealDate('2026-10-30'), true);
  assert.equal(isRealDate('2028-02-29'), true);
  assert.equal(isRealDate('2026-02-30'), false);
  assert.equal(isRealDate('2026-13-01'), false);
  assert.equal(isRealDate('30/10/2026'), false);
  assert.equal(isRealDate(''), false);
});

test('UT-VD-11 schema date ตัดเวลาออกเหลือ YYYY-MM-DD', () => {
  assert.equal(validate({ d: '2026-10-30T10:00:00Z' }, { d: { type: 'date' } }).d, '2026-10-30');
  assert.ok(errorsOf({ d: '2026-02-31' }, { d: { type: 'date' } }));
});

test('UT-VD-12 รหัสผ่านต้องเป็นสตริงอย่างน้อย 6 ตัว', () => {
  assert.doesNotThrow(() => assertStrongPassword('123456'));
  assert.throws(() => assertStrongPassword('12345'));
  assert.throws(() => assertStrongPassword(123456));
});
