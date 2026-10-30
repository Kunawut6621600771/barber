import { test, before } from 'node:test';
import assert from 'node:assert/strict';
import { api, login, newCustomer, ACCOUNTS } from './helpers.js';

let admin; let staff; let barber; let cust; let staffId;

before(async () => {
  admin = await login(ACCOUNTS.admin);
  staff = await login(ACCOUNTS.staff);
  barber = await login(ACCOUNTS.barber);
  cust = await newCustomer('role');
  staffId = (await api('GET', '/auth/me', { token: staff })).data.user.id;
});

test('E2E-R-01 ไม่ได้ล็อกอิน เรียก API ที่ต้องล็อกอิน -> 401', async () => {
  for (const p of ['/queue/my', '/auth/me', '/users', '/reports/customers']) {
    const r = await api('GET', p);
    assert.equal(r.status, 401, `${p} ได้ ${r.status}`);
  }
});

test('E2E-R-02 token ปลอม -> 401', async () => {
  const r = await api('GET', '/auth/me', { token: 'not.a.jwt' });
  assert.equal(r.status, 401);
});

test('E2E-R-03 ล็อกอินรหัสผิด -> 401 และรหัสเป็นตัวเลขไม่ทำให้ระบบล่ม', async () => {
  const wrong = await api('POST', '/auth/login', { body: { email: ACCOUNTS.staff, password: 'wrongpass' } });
  assert.equal(wrong.status, 401);
  const numeric = await api('POST', '/auth/login', { body: { email: ACCOUNTS.staff, password: 123456 } });
  assert.notEqual(numeric.status, 500);
});

test('E2E-R-04 ลูกค้าเข้าหน้าจัดการคิว / รายงาน / ผู้ใช้ไม่ได้ -> 403', async () => {
  for (const [m, p] of [['GET', '/queue'], ['GET', '/reports/customers'], ['GET', '/users'], ['POST', '/queue/call']]) {
    const r = await api(m, p, { token: cust.token, body: m === 'POST' ? {} : undefined });
    assert.equal(r.status, 403, `${m} ${p} ได้ ${r.status}`);
  }
});

test('E2E-R-05 ลูกค้าไม่เห็นอีเมล/เบอร์ของช่างใน /barbers', async () => {
  const r = await api('GET', '/barbers', { token: cust.token });
  assert.equal(r.status, 200);
  for (const b of r.data.data) {
    assert.equal(b.email, undefined);
    assert.equal(b.phone, undefined);
  }
});

test('E2E-R-06 ช่างเรียกคิวได้ แต่จัดการผู้ใช้ไม่ได้', async () => {
  assert.equal((await api('GET', '/queue', { token: barber })).status, 200);
  assert.equal((await api('GET', '/users', { token: barber })).status, 403);
});

test('E2E-R-07 พนักงานตั้งตัวเองเป็น admin ไม่ได้ -> 403', async () => {
  const r = await api('PUT', `/users/${staffId}`, { token: staff, body: { role: 'admin' } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
  const me = await api('GET', '/auth/me', { token: staff });
  assert.equal(me.data.user.role, 'staff');
});

test('E2E-R-08 พนักงานสร้างบัญชี admin ไม่ได้ แต่สร้างบัญชีลูกค้าได้', async () => {
  const u = Date.now();
  const a = await api('POST', '/users', {
    token: staff, body: { full_name: 'แอบเป็นแอดมิน', email: `x${u}@example.com`, phone: '0890000000', role: 'admin', password: '123456' },
  });
  assert.equal(a.status, 403, JSON.stringify(a.data));
  const c = await api('POST', '/users', {
    token: staff, body: { full_name: 'ลูกค้าใหม่', email: `y${u}@example.com`, phone: '0890000001', role: 'customer', password: '123456' },
  });
  assert.equal(c.status, 201, JSON.stringify(c.data));
});

test('E2E-R-09 พนักงานแก้ไขบัญชี admin ไม่ได้', async () => {
  const list = await api('GET', '/users?role=admin', { token: admin });
  const adminUser = list.data.data.find((x) => x.role === 'admin');
  const r = await api('PUT', `/users/${adminUser.id}`, { token: staff, body: { status: 'suspended' } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

test('E2E-R-10 เฉพาะ admin แก้การตั้งค่าร้านได้', async () => {
  assert.equal((await api('PUT', '/settings', { token: staff, body: {} })).status, 403);
  const ok = await api('GET', '/settings', { token: admin });
  assert.equal(ok.status, 200);
});

test('E2E-R-11 ลูกค้ากำหนดลำดับความสำคัญคิวเองไม่ได้', async () => {
  const svcs = await api('GET', '/services', { token: cust.token });
  const sid = (svcs.data.data || svcs.data)[0].id;
  const r = await api('POST', '/queue', { token: cust.token, body: { service_id: sid, priority: 9 } });
  assert.equal(r.status, 403, JSON.stringify(r.data));
});

test('E2E-R-12 ลูกค้ายกเลิกคิวของคนอื่นไม่ได้', async () => {
  const svcs = await api('GET', '/services', { token: staff });
  const sid = (svcs.data.data || svcs.data)[0].id;
  const t = (await api('POST', '/queue', { token: staff, body: { service_id: sid, guest_name: 'คิวของคนอื่น' } })).data.ticket;
  const r = await api('POST', `/queue/${t.id}/cancel`, { token: cust.token, body: {} });
  assert.ok([403, 404].includes(r.status), `ได้ ${r.status}`);
  await api('POST', `/queue/${t.id}/cancel`, { token: staff, body: {} });
});
