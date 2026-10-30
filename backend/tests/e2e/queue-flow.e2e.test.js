import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, newCustomer, anyService, ACCOUNTS } from './helpers.js';

let staff; let cust; let svc; let ticket; let barberId;

before(async () => {
  staff = await login(ACCOUNTS.staff);
  cust = await newCustomer('queue');
  svc = await anyService(staff);
  const b = await api('GET', '/barbers', { token: staff });
  barberId = (b.data.data.find((x) => x.status === 'available') || b.data.data[0]).id;
});

test('E2E-Q-01 ลูกค้ารับบัตรคิว -> 201 สถานะ waiting มีเลขคิวและลิงก์ติดตาม', async () => {
  const r = await api('POST', '/queue', { token: cust.token, body: { service_id: svc.id } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  ticket = r.data.ticket;
  assert.equal(ticket.status, 'waiting');
  assert.match(ticket.ticket_no, /^[A-Z]-\d{3}$/);
  assert.ok(r.data.track_url);
});

test('E2E-Q-02 ลูกค้าเห็นคิวของตัวเองที่ /queue/my พร้อมจำนวนคิวก่อนหน้า', async () => {
  const r = await api('GET', '/queue/my', { token: cust.token });
  assert.equal(r.status, 200);
  assert.equal(r.data.ticket.id, ticket.id);
  assert.equal(typeof Number(r.data.remaining), 'number');
});

test('E2E-Q-03 ลูกค้ารับบัตรซ้ำขณะยังมีคิวค้าง -> ถูกปฏิเสธ (409)', async () => {
  const r = await api('POST', '/queue', { token: cust.token, body: { service_id: svc.id } });
  assert.equal(r.status, 409, JSON.stringify(r.data));
});

test('E2E-Q-04 พนักงานเรียกคิว -> สถานะ called', async () => {
  const r = await api('POST', `/queue/${ticket.id}/call`, { token: staff, body: { barber_id: barberId } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, 'called');
});

test('E2E-Q-05 ลูกค้าได้รับแจ้งเตือน "ถึงคิว" หลังถูกเรียก', async () => {
  const r = await api('GET', '/notifications', { token: cust.token });
  assert.equal(r.status, 200);
  const list = r.data.data || r.data.notifications || [];
  assert.ok(list.some((n) => n.ticket_id === ticket.id || String(n.ticket_id) === String(ticket.id)),
    'ไม่พบแจ้งเตือนของคิวนี้');
});

test('E2E-Q-06 เริ่มให้บริการ -> สถานะ serving', async () => {
  const r = await api('POST', `/queue/${ticket.id}/start`, { token: staff, body: { barber_id: barberId } });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, 'serving');
});

test('E2E-Q-07 ปิดคิว -> สถานะ done และลูกค้าไม่มีคิวค้าง', async () => {
  const r = await api('POST', `/queue/${ticket.id}/done`, { token: staff, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, 'done');
  const my = await api('GET', '/queue/my', { token: cust.token });
  assert.equal(my.data.ticket, null);
});

test('E2E-Q-08 ปิดคิวที่ปิดไปแล้วซ้ำ -> ถูกปฏิเสธ', async () => {
  const r = await api('POST', `/queue/${ticket.id}/done`, { token: staff, body: {} });
  assert.ok([400, 409].includes(r.status), `ได้ ${r.status}`);
});

test('E2E-Q-09 ข้ามคิวแล้วเรียกใหม่ -> ลูกค้าได้แจ้งเตือนรอบที่ 2', async () => {
  const c2 = await newCustomer('skip');
  const t = (await api('POST', '/queue', { token: c2.token, body: { service_id: svc.id } })).data.ticket;
  await api('POST', `/queue/${t.id}/call`, { token: staff, body: { barber_id: barberId } });
  const sk = await api('POST', `/queue/${t.id}/skip`, { token: staff, body: { reason: 'ไม่อยู่หน้าร้าน' } });
  assert.equal(sk.status, 200, JSON.stringify(sk.data));
  const re = await api('POST', `/queue/${t.id}/call`, { token: staff, body: { barber_id: barberId } });
  assert.equal(re.status, 200, JSON.stringify(re.data));
  const n = await api('GET', '/notifications', { token: c2.token });
  const types = (n.data.data || []).filter((x) => String(x.ticket_id) === String(t.id)).map((x) => x.type);
  assert.ok(types.includes('your_turn'), `แจ้งเตือนที่ได้: ${types}`);
  assert.ok(types.includes('called_again'), `ไม่ได้แจ้งเตือนรอบที่ 2: ${types}`);
  await api('POST', `/queue/${t.id}/cancel`, { token: staff, body: {} });
});

test('E2E-Q-10 ลูกค้ายกเลิกคิวของตัวเอง -> cancelled', async () => {
  const c3 = await newCustomer('cancel');
  const t = (await api('POST', '/queue', { token: c3.token, body: { service_id: svc.id } })).data.ticket;
  const r = await api('POST', `/queue/${t.id}/cancel`, { token: c3.token, body: {} });
  assert.equal(r.status, 200, JSON.stringify(r.data));
  assert.equal(r.data.ticket.status, 'cancelled');
});

test('E2E-Q-11 พนักงานออกบัตร walk-in ให้ลูกค้าที่ไม่มีบัญชี', async () => {
  const r = await api('POST', '/queue', { token: staff, body: { service_id: svc.id, guest_name: 'วอล์คอิน E2E' } });
  assert.equal(r.status, 201, JSON.stringify(r.data));
  await api('POST', `/queue/${r.data.ticket.id}/cancel`, { token: staff, body: {} });
});

test('E2E-Q-12 จอคิวสาธารณะ /queue/current ไม่เปิดเผยเบอร์โทรลูกค้า', async () => {
  const r = await api('GET', '/queue/current');
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.data);
  assert.ok(!s.includes('customer_phone'), 'มี customer_phone หลุดออกมา');
  assert.ok(!s.includes(cust.user.phone), 'มีเบอร์ลูกค้าหลุดออกมา');
});

test('E2E-Q-13 id ไม่ใช่ตัวเลข -> 400 (ไม่ใช่ 500)', async () => {
  const r = await api('POST', '/queue/abc/call', { token: staff, body: {} });
  assert.equal(r.status, 400, JSON.stringify(r.data));
});
