import { test } from 'node:test';
import assert from 'node:assert/strict';
import { crc16, promptpayPayload, maskPromptpay } from '../../src/utils/promptpay.js';

/** แยก payload EMVCo เป็น { tag: value } (ระดับบนสุด) */
function parseTlv(s) {
  const out = {};
  let i = 0;
  while (i < s.length) {
    const tag = s.slice(i, i + 2);
    const len = Number(s.slice(i + 2, i + 4));
    out[tag] = s.slice(i + 4, i + 4 + len);
    i += 4 + len;
  }
  return out;
}

test('UT-PP-01 crc16 ค่ามาตรฐาน CCITT-FALSE ของ "123456789" = 29B1', () => {
  assert.equal(crc16('123456789'), '29B1');
});

test('UT-PP-02 crc16 ของสตริงว่าง = FFFF และยาว 4 หลักเสมอ', () => {
  assert.equal(crc16(''), 'FFFF');
  assert.match(crc16('A'), /^[0-9A-F]{4}$/);
});

test('UT-PP-03 เบอร์มือถือ 08x แปลงเป็น 0066 + 9 หลัก ใน tag 29/01', () => {
  const t = parseTlv(promptpayPayload('0812345678', 150));
  const merchant = parseTlv(t['29']);
  assert.equal(merchant['00'], 'A000000677010111');
  assert.equal(merchant['01'], '0066812345678');
});

test('UT-PP-04 มีจำนวนเงิน -> QR ใช้ครั้งเดียว (01=12) และ tag 54 ทศนิยม 2 ตำแหน่ง', () => {
  const t = parseTlv(promptpayPayload('0812345678', 150));
  assert.equal(t['01'], '12');
  assert.equal(t['54'], '150.00');
  assert.equal(t['53'], '764');
  assert.equal(t['58'], 'TH');
});

test('UT-PP-05 ไม่มีจำนวนเงิน / 0 บาท -> QR ใช้ซ้ำ (01=11) และไม่มี tag 54', () => {
  for (const amt of [undefined, null, 0]) {
    const t = parseTlv(promptpayPayload('0812345678', amt));
    assert.equal(t['01'], '11');
    assert.equal(t['54'], undefined);
  }
});

test('UT-PP-06 เลขบัตรประชาชน 13 หลักใช้ tag 02, e-Wallet 15 หลักใช้ tag 03', () => {
  assert.equal(parseTlv(parseTlv(promptpayPayload('1234567890123', 10))['29'])['02'], '1234567890123');
  assert.equal(parseTlv(parseTlv(promptpayPayload('123456789012345', 10))['29'])['03'], '123456789012345');
});

test('UT-PP-07 ตัดขีด/ช่องว่างออกจากเบอร์ก่อนสร้าง QR', () => {
  assert.equal(promptpayPayload('081-234-5678', 99.5), promptpayPayload('0812345678', 99.5));
});

test('UT-PP-08 CRC ท้าย payload ตรงกับ crc16 ของข้อความก่อนหน้า (รวม "6304")', () => {
  const p = promptpayPayload('0812345678', 250.75);
  assert.equal(p.slice(-8, -4), '6304');
  assert.equal(p.slice(-4), crc16(p.slice(0, -4)));
});

test('UT-PP-09 ไม่ได้ตั้ง PROMPTPAY_ID -> โยน error', () => {
  assert.throws(() => promptpayPayload('', 100), /PROMPTPAY_ID/);
});

test('UT-PP-10 maskPromptpay ปิดเลขกลางของเบอร์ และเหลือ 4 ตัวท้ายของเลขยาว', () => {
  assert.equal(maskPromptpay('0812345678'), '081-xxx-5678');
  assert.equal(maskPromptpay('1234567890123'), 'xxxxxxxxx0123');
  assert.equal(maskPromptpay(''), '');
});
