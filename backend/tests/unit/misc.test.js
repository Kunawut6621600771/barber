import { test } from 'node:test';
import assert from 'node:assert/strict';
import { maskName } from '../../src/utils/mask.js';
import { num, bool } from '../../src/utils/settings.js';
import { detectIntent } from '../../src/utils/line-bot.js';
import { LINK_RE } from '../../src/utils/line-link.js';
import { ApiError } from '../../src/utils/http.js';

test('UT-MS-01 maskName ปิดนามสกุลเหลืออักษรแรก และชื่อเดี่ยวไม่เปลี่ยน', () => {
  assert.equal(maskName('สมชาย ใจดี'), 'สมชาย ใ.');
  assert.equal(maskName('  Arin   Suwan '), 'Arin S.');
  assert.equal(maskName('มิ้น'), 'มิ้น');
  assert.equal(maskName(null), null);
});

test('UT-MS-02 settings.num คืน fallback เมื่อค่าไม่ใช่ตัวเลข', () => {
  assert.equal(num('0.05', 1), 0.05);
  assert.equal(num('abc', 7), 7);
  assert.equal(num(undefined, 3), 3);
});

test('UT-MS-03 settings.bool รับ "true" และใช้ fallback เมื่อว่าง', () => {
  assert.equal(bool('true'), true);
  assert.equal(bool('false', true), false);
  assert.equal(bool('', true), true);
  assert.equal(bool(null, false), false);
});

test('UT-MS-04 LINE bot จับเจตนาจากข้อความลูกค้า', () => {
  assert.equal(detectIntent('ร้านอยู่ไหนครับ'), 'location');
  assert.equal(detectIntent('ขอเบอร์ร้านหน่อย'), 'contact');
  assert.equal(detectIntent('แต้มสะสมเหลือเท่าไร'), 'points');
  assert.equal(detectIntent('มีโปรอะไรบ้าง'), 'promo');
  assert.equal(detectIntent('สวัสดีครับ'), 'greet');
});

test('UT-MS-05 LINE bot ข้อความว่างตอบเมนู และข้อความที่ไม่รู้จักเป็น fallback', () => {
  assert.equal(detectIntent(''), 'help');
  assert.equal(detectIntent('   '), 'help');
  assert.equal(detectIntent('qwertyuiop'), 'fallback');
});

test('UT-MS-06 รหัสผูกบัญชี LINE จับรูปแบบ LINK-XXXXXX ในข้อความ', () => {
  assert.equal(LINK_RE.exec('เชื่อมบัญชีคิว LINK-AB12CD')?.[1], 'AB12CD');
  assert.equal(LINK_RE.exec('LINK-12'), null);
});

test('UT-MS-07 ApiError มี status code ตามชนิด', () => {
  assert.equal(ApiError.badRequest('x').status, 400);
  assert.equal(ApiError.notFound('x').status, 404);
  assert.equal(ApiError.conflict('x').status, 409);
});
