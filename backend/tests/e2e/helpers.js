/** ตัวช่วยยิง API จริงของ backend ทดสอบ (ฐาน barbershop_test พอร์ต 5051) */
export const BASE = process.env.API_BASE || 'http://localhost:5051/api';

export async function api(method, path, { token, body } = {}) {
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = text; }
  return { status: res.status, data, headers: res.headers };
}

const tokens = {};
export async function login(email, password = '123456') {
  if (tokens[email]) return tokens[email];
  const r = await api('POST', '/auth/login', { body: { email, password } });
  if (r.status !== 200) throw new Error(`login ${email} -> ${r.status} ${JSON.stringify(r.data)}`);
  tokens[email] = r.data.token;
  return r.data.token;
}

export const ACCOUNTS = {
  admin: 'admin@trimco.local',
  staff: 'staff@trimco.local',
  barber: 'barber1@trimco.local',
  customer: 'arin@example.com',
};

/** สมัครลูกค้าใหม่ที่ไม่ซ้ำกันในแต่ละรอบทดสอบ */
export async function newCustomer(tag = 'c') {
  const uniq = `${Date.now()}${Math.floor(Math.random() * 1000)}`;
  const email = `e2e_${tag}_${uniq}@example.com`;
  const r = await api('POST', '/auth/register', {
    body: { full_name: `ทดสอบ ${tag}`, email, phone: `09${uniq.slice(-8)}`, password: '123456' },
  });
  if (r.status !== 201) throw new Error(`register -> ${r.status} ${JSON.stringify(r.data)}`);
  return { token: r.data.token, user: r.data.user, email };
}

/** บริการแรกที่เปิดใช้งาน */
export async function anyService(token) {
  const r = await api('GET', '/services', { token });
  const list = r.data.data || r.data;
  return list.find((s) => s.is_active !== false) || list[0];
}

/** วันที่ตามเขตเวลาร้าน + n วัน (YYYY-MM-DD) */
export function shopDate(plusDays = 0) {
  const d = new Date(Date.now() + plusDays * 86_400_000);
  return d.toLocaleDateString('en-CA', { timeZone: 'Asia/Bangkok' });
}
