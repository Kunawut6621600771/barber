import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, newCustomer, anyService, shopDate, ACCOUNTS } from './helpers.js';

let staff; let cust; let svc; let appt; let slotTime;
const date = shopDate(2);

before(async () => {
  staff = await login(ACCOUNTS.staff);
  cust = await newCustomer('appt');
  svc = await anyService(staff);
});

test('E2E-A-01 ดูช่วงเวลาว่างของวันถัดไป (ไม่ต้องล็อกอิน)', async () => {
  const r = await api('GET', `/appointments/slots?date=${date}&service_id=${svc.id}`);
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.ok(r.data.slots.length > 0);
  slotTime = r.data.slots.find((s) => s.available).time;
  assert.ok(slotTime);
});

test('E2E-A-02 ลูกค้าจองล่วงหน้า -> 201 และอยู่ในรายการ "การจองของฉัน"', async () => {
  const r = await api('POST', '/appointments', {
    token: cust.token, body: { service_id: svc.id, appoint_date: date, appoint_time: slotTime },
  });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  appt = r.data.appointment;
  const my = await api('GET', '/appointments/my', { token: cust.token });
  assert.ok(my.data.data.some((a) => a.id === appt.id));
});

test('E2E-A-03 จองวันที่ไม่มีจริง (2026-02-30) -> 400', async () => {
  const r = await api('POST', '/appointments', {
    token: cust.token, body: { service_id: svc.id, appoint_date: '2026-02-30', appoint_time: '10:00' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test('E2E-A-04 จองย้อนหลัง (เมื่อวาน) -> 400', async () => {
  const r = await api('POST', '/appointments', {
    token: cust.token, body: { service_id: svc.id, appoint_date: shopDate(-1), appoint_time: '10:00' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test('E2E-A-05 จองเกินจำนวนวันล่วงหน้าที่ร้านกำหนด -> 400', async () => {
  const r = await api('POST', '/appointments', {
    token: cust.token, body: { service_id: svc.id, appoint_date: shopDate(60), appoint_time: '10:00' },
  });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});

test('E2E-A-06 จำนวนที่จองในช่วงเวลานั้นเพิ่มขึ้นหลังจอง', async () => {
  const r = await api('GET', `/appointments/slots?date=${date}&service_id=${svc.id}`);
  const slot = r.data.slots.find((s) => s.time === slotTime);
  assert.ok(slot.booked >= 1, JSON.stringify(slot));
});

test('E2E-A-07 พนักงานเห็นการจองในรายการของวันนั้น', async () => {
  const r = await api('GET', `/appointments?date=${date}`, { token: staff });
  assert.equal(r.status, 200);
  assert.ok(r.data.data.some((a) => a.id === appt.id));
});

test('E2E-A-08 ลูกค้าคนอื่นยกเลิกการจองที่ไม่ใช่ของตัวเองไม่ได้', async () => {
  const other = await newCustomer('appt2');
  const r = await api('POST', `/appointments/${appt.id}/cancel`, { token: other.token, body: {} });
  assert.ok([403, 404].includes(r.status), `ได้ ${r.status}`);
});

test('E2E-A-09 ลูกค้ายกเลิกการจองของตัวเอง และยกเลิกซ้ำไม่ได้', async () => {
  const r = await api('POST', `/appointments/${appt.id}/cancel`, { token: cust.token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  const again = await api('POST', `/appointments/${appt.id}/cancel`, { token: cust.token, body: {} });
  assert.ok([400, 409].includes(again.status), `ได้ ${again.status}`);
});

test('E2E-A-10 จองวันนี้แล้วพนักงานเช็กอิน -> ได้บัตรคิวแบบมีลำดับความสำคัญ', async () => {
  const c = await newCustomer('checkin');
  const today = shopDate(0);
  const slots = await api('GET', `/appointments/slots?date=${today}&service_id=${svc.id}`);
  const free = slots.data.slots.find((s) => s.available);
  if (!free) return; // ร้านปิดแล้วสำหรับวันนี้ — ไม่มีช่วงให้จอง
  const a = await api('POST', '/appointments', {
    token: c.token, body: { service_id: svc.id, appoint_date: today, appoint_time: free.time },
  });
  assert.equal(a.status, 201, JSON.stringify(a.data));
  const r = await api('POST', `/appointments/${a.data.appointment.id}/checkin`, { token: staff, body: {} });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, 'waiting');
  assert.ok(r.data.ticket.priority > 0);
  await api('POST', `/queue/${r.data.ticket.id}/cancel`, { token: staff, body: {} });
});
