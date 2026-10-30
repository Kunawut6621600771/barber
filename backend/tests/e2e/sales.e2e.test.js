import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, newCustomer, anyService, ACCOUNTS } from './helpers.js';

let admin; let staff; let svc; let cust;

/** เปิดบิล ใส่บริการ 1 รายการ แล้วคืน sale */
async function billWith(body = {}) {
  const s = (await api('POST', '/pos/sales', { token: staff, body })).data.sale;
  const r = await api('POST', `/pos/sales/${s.id}/items`, { token: staff, body: { kind: 'service', service_id: svc.id } });
  return r.data.sale;
}

before(async () => {
  admin = await login(ACCOUNTS.admin);
  staff = await login(ACCOUNTS.staff);
  svc = await anyService(staff);
  cust = await newCustomer('sale');
  const cur = await api('GET', '/shifts/current', { token: staff });
  if (!cur.data.shift) await api('POST', '/shifts/open', { token: staff, body: { opening_float: 1000 } });
});

test('E2E-S-01 บันทึกเงินเข้าลิ้นชักมีเศษสตางค์ (150.50) ได้ ไม่ error 500', async () => {
  const r = await api('POST', '/shifts/cash', { token: staff, body: { direction: 'in', amount: 150.5, reason: 'ทดสอบ' } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('E2E-S-02 ชำระบิลด้วยเงินสด -> paid คำนวณเงินทอนถูกต้อง', async () => {
  const s = await billWith({ guest_name: 'บิลทดสอบ' });
  const total = Number(s.total);
  const r = await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: total + 100 }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.sale.status, 'paid');
  assert.equal(Number(r.data.change), 100);
});

test('E2E-S-03 จ่ายไม่ครบยอด -> 400', async () => {
  const s = await billWith({ guest_name: 'จ่ายไม่ครบ' });
  const r = await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: 1 }] },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test('E2E-S-04 สมาชิกได้แต้มสะสมหลังชำระเงิน', async () => {
  const before = (await api('GET', '/loyalty/me', { token: cust.token })).data.user.loyalty_points;
  const s = await billWith({ customer_id: cust.user.id });
  const r = await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: Number(s.total) }] },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = (await api('GET', '/loyalty/me', { token: cust.token })).data.user.loyalty_points;
  assert.equal(after - before, Number(r.data.sale.points_earned));
  assert.ok(Number(r.data.sale.points_earned) > 0);
});

test('E2E-S-05 คืนเงินเต็มบิลสมาชิก -> หักแต้มที่ได้คืน', async () => {
  const s = await billWith({ customer_id: cust.user.id });
  const paid = (await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: Number(s.total) }] },
  })).data.sale;
  const before = (await api('GET', '/loyalty/me', { token: cust.token })).data.user.loyalty_points;
  const r = await api('POST', `/pos/sales/${paid.id}/refund`, {
    token: staff, body: { amount: Number(paid.total), method: 'cash', reason: 'ทดสอบคืนเงิน' },
  });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const after = (await api('GET', '/loyalty/me', { token: cust.token })).data.user.loyalty_points;
  assert.equal(before - after, Number(paid.points_earned));
});

test('E2E-S-06 ยกเลิกบิลที่คืนเงินไปแล้ว -> 409 (กันคืนสต็อก/เงินซ้ำ)', async () => {
  const s = await billWith({ guest_name: 'คืนแล้วยกเลิก' });
  const paid = (await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: Number(s.total) }] },
  })).data.sale;
  await api('POST', `/pos/sales/${paid.id}/refund`, { token: staff, body: { amount: 10, method: 'cash' } });
  const r = await api('POST', `/pos/sales/${paid.id}/void`, { token: admin, body: { reason: 'ทดสอบ' } });
  assert.equal(r.status, 409, JSON.stringify(r.data));
});

test('E2E-S-07 ใช้แต้มเกินยอดบิล -> 400', async () => {
  await api('POST', `/loyalty/${cust.user.id}/adjust`, { token: admin, body: { points: 5000, note: 'เติมแต้มทดสอบ' } });
  const s = await billWith({ customer_id: cust.user.id });
  const r = await api('PATCH', `/pos/sales/${s.id}`, { token: staff, body: { points_used: 5000 } });
  assert.equal(r.status, 400, JSON.stringify(r.data));
  await api('POST', `/pos/sales/${s.id}/void`, { token: staff, body: {} });
});

test('E2E-S-08 ลบโค้ดส่วนลดออกจากบิล -> ส่วนลดหายไปด้วย', async () => {
  const code = `T${Date.now().toString().slice(-6)}`;
  const p = await api('POST', '/pos/promos', {
    token: admin, body: { code, discount_type: 'amount', discount_value: 50 },
  });
  assert.equal(p.status, 201, JSON.stringify(p.data));
  const s = await billWith({ guest_name: 'โค้ดส่วนลด' });
  const withPromo = await api('PATCH', `/pos/sales/${s.id}`, { token: staff, body: { promo_code: code } });
  assert.equal(Number(withPromo.data.sale.discount_amount), 50);
  const removed = await api('PATCH', `/pos/sales/${s.id}`, { token: staff, body: { promo_code: '' } });
  assert.equal(Number(removed.data.sale.discount_amount), 0);
  await api('POST', `/pos/sales/${s.id}/void`, { token: staff, body: {} });
});

test('E2E-S-09 โค้ดที่ใช้ได้ถึงวันนี้ ยังใช้ได้ในวันนี้', async () => {
  const today = new Date().toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
  const code = `D${Date.now().toString().slice(-6)}`;
  await api('POST', '/pos/promos', {
    token: admin, body: { code, discount_type: 'percent', discount_value: 10, ends_at: today },
  });
  const r = await api('POST', '/pos/promo/check', { token: staff, body: { code, subtotal: 500 } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});

test('E2E-S-10 รายงานส่งวันที่ผิดรูปแบบ -> 400', async () => {
  const r = await api('GET', '/reports/sales?from=abc&to=2026-10-30', { token: staff });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test('E2E-S-11 ส่งออก CSV ใส่ \' หน้าค่าที่ขึ้นต้นด้วย = (กันสูตร Excel)', async () => {
  const s = (await api('POST', '/pos/sales', { token: staff, body: { guest_name: '=HYPERLINK("x")' } })).data.sale;
  await api('POST', `/pos/sales/${s.id}/items`, { token: staff, body: { kind: 'service', service_id: svc.id } });
  const fresh = (await api('GET', `/pos/sales/${s.id}`, { token: staff })).data.sale;
  await api('POST', `/pos/sales/${s.id}/checkout`, {
    token: staff, body: { payments: [{ method: 'cash', amount: Number(fresh.total) }] },
  });
  const r = await api('GET', '/reports/sales/export', { token: staff });
  assert.equal(r.status, 200);
  assert.ok(!/(^|,)"?=HYPERLINK/m.test(r.data), 'ยังมีค่าที่ขึ้นต้นด้วย = อยู่ใน CSV');
  assert.ok(r.data.includes("'=HYPERLINK"), 'ไม่พบค่าที่ถูก escape');
});
