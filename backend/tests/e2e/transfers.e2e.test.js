import crypto from 'node:crypto';
import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, newCustomer, anyService, ACCOUNTS, shopDate } from './helpers.js';

let admin; let staff; let barber; let cust; let svc; let payment;

// PNG ปลอมที่ไม่ซ้ำกันทุกรอบ (provider mock ใช้ hash ของรูปเป็นเลขธุรกรรม กันสลิปซ้ำ)
const fakePng = () => `data:image/png;base64,${Buffer.concat([
  Buffer.from('89504e470d0a1a0a', 'hex'), crypto.randomBytes(200),
]).toString('base64')}`;

before(async () => {
  admin = await login(ACCOUNTS.admin);
  staff = await login(ACCOUNTS.staff);
  barber = await login(ACCOUNTS.barber);
  cust = await newCustomer('pay');
  svc = await anyService(staff);
  const r = await api('POST', '/payments', { token: cust.token, body: { service_id: svc.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  payment = r.data.payment;
});

test('E2E-T-01 ลูกค้าส่งสลิปที่ไม่ใช่รูป -> 422 และไม่เก็บไฟล์นั้น', async () => {
  const svg = `data:image/svg+xml;base64,${Buffer.from(`<svg>${'x'.repeat(200)}</svg>`).toString('base64')}`;
  const sent = await api('POST', `/payments/${payment.id}/slip`, { token: cust.token, body: { image: svg } });
  assert.equal(sent.status, 422, JSON.stringify(sent.data));
  assert.equal(sent.data.details?.code, 'not_image');
  const r = await api('GET', `/payments/${payment.id}/slips`, { token: staff });
  assert.equal(r.status, 200);
  assert.equal(r.data.slips.length, 0, 'ไม่ควรเก็บไฟล์ที่ไม่ใช่รูปบิตแมป');
});

test('E2E-T-02 ส่งสลิปผ่าน -> ได้บัตรคิว และเก็บรูปสลิปไว้ 1 ใบ', async () => {
  const r = await api('POST', `/payments/${payment.id}/slip`, { token: cust.token, body: { image: fakePng() } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.payment.status, 'paid');

  const s = await api('GET', `/payments/${payment.id}/slips`, { token: staff });
  assert.equal(s.status, 200);
  assert.equal(s.data.slips.length, 1);
  assert.equal(s.data.slips[0].ok, true);
  assert.match(s.data.slips[0].image, /^data:image\/png;base64,/);
});

test('E2E-T-03 ประวัติการโอน: ค้นด้วยชื่อลูกค้าเจอรายการ พร้อมชื่อและจำนวนสลิป', async () => {
  const r = await api('GET', `/payments/history?from=${shopDate()}&to=${shopDate()}&search=${encodeURIComponent(payment.ref_code)}`, { token: admin });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const row = r.data.data.find((p) => p.id === payment.id);
  assert.ok(row, 'ต้องเจอรายการที่เพิ่งโอน');
  assert.equal(row.customer_name, cust.user.full_name);
  assert.equal(row.slip_count, 1);
  assert.equal(row.status, 'paid');
  assert.ok(r.data.summary.paid_amount >= Number(payment.amount));

  const byName = await api('GET', `/payments/history?search=${encodeURIComponent(cust.user.full_name)}`, { token: staff });
  assert.ok(byName.data.data.some((p) => p.id === payment.id), 'ค้นด้วยชื่อลูกค้าต้องเจอ');
});

test('E2E-T-04 ลูกค้า / ช่าง ดูประวัติการโอนและสลิปของคนอื่นไม่ได้ -> 403', async () => {
  for (const token of [cust.token, barber]) {
    assert.equal((await api('GET', '/payments/history', { token })).status, 403);
    assert.equal((await api('GET', `/payments/${payment.id}/slips`, { token })).status, 403);
  }
  assert.equal((await api('GET', '/payments/history')).status, 401);
});

test('E2E-T-05 วันที่ผิดรูปแบบไม่ทำให้ระบบล่ม (ใช้วันนี้แทน)', async () => {
  const r = await api('GET', `/payments/history?from=${encodeURIComponent("2026-01-01'; --")}&to=abc`, { token: staff });
  assert.equal(r.status, 200, JSON.stringify(r.data));
});
