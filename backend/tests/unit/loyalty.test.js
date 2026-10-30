import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pointsEarnedFor, discountAmount, maxRedeemablePoints, pointsToReverse } from '../../src/utils/loyalty.js';

test('UT-LY-01 แต้มที่ได้ = ยอด x อัตรา ปัดลง (300 บาท x 0.05 = 15 แต้ม)', () => {
  assert.equal(pointsEarnedFor(300, 0.05), 15);
  assert.equal(pointsEarnedFor(319, 0.05), 15);
});

test('UT-LY-02 ทศนิยมลอยตัวไม่ทำให้แต้มหาย (100 x 0.29 ต้องได้ 29)', () => {
  assert.equal(pointsEarnedFor(100, 0.29), 29);
  assert.equal(pointsEarnedFor(700, 0.01), 7);
});

test('UT-LY-03 ยอด 0 / ติดลบ / อัตรา 0 -> ได้ 0 แต้ม', () => {
  assert.equal(pointsEarnedFor(0, 0.05), 0);
  assert.equal(pointsEarnedFor(-50, 0.05), 0);
  assert.equal(pointsEarnedFor(500, 0), 0);
});

test('UT-LY-04 ส่วนลดเปอร์เซ็นต์ปัด 2 ตำแหน่ง และไม่เกิน 100%', () => {
  assert.equal(discountAmount(333, 'percent', 10), 33.3);
  assert.equal(discountAmount(200, 'percent', 150), 200);
});

test('UT-LY-05 ส่วนลดบาทไม่เกินยอดรวม และค่าติดลบนับเป็น 0', () => {
  assert.equal(discountAmount(100, 'amount', 30), 30);
  assert.equal(discountAmount(100, 'amount', 250), 100);
  assert.equal(discountAmount(100, 'amount', -20), 0);
  assert.equal(discountAmount(100, null, null), 0);
});

test('UT-LY-06 ใช้แต้มได้ไม่เกินยอดคงเหลือ (แต้มละ 1 บาท ยอด 80.5 -> 80 แต้ม)', () => {
  assert.equal(maxRedeemablePoints(80.5, 1), 80);
  assert.equal(maxRedeemablePoints(100, 0.5), 200);
  assert.equal(maxRedeemablePoints(0, 1), 0);
  assert.equal(maxRedeemablePoints(100, 0), 0);
});

test('UT-LY-07 คืนเงินเต็มจำนวน -> หักแต้มที่ได้ทั้งหมด', () => {
  assert.equal(pointsToReverse({ earned: 15, total: 300, refundedBefore: 0, refundedAfter: 300, isFull: true }), 15);
});

test('UT-LY-08 คืนบางส่วน -> หักตามสัดส่วน และคืนครั้งที่ 2 ไม่หักซ้ำ', () => {
  const first = pointsToReverse({ earned: 20, total: 400, refundedBefore: 0, refundedAfter: 100, isFull: false });
  assert.equal(first, 5);
  const second = pointsToReverse({ earned: 20, total: 400, refundedBefore: 100, refundedAfter: 400, isFull: true });
  assert.equal(first + second, 20);
});

test('UT-LY-09 บิลที่ไม่ได้แต้มหรือยอด 0 -> ไม่หักแต้ม', () => {
  assert.equal(pointsToReverse({ earned: 0, total: 300, refundedBefore: 0, refundedAfter: 300, isFull: true }), 0);
  assert.equal(pointsToReverse({ earned: 10, total: 0, refundedBefore: 0, refundedAfter: 0, isFull: true }), 0);
});
