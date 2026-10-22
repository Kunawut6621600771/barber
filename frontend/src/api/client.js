const BASE = '/api';

const store = {
  get token() { return localStorage.getItem('tq_token'); },
  set token(v) { v ? localStorage.setItem('tq_token', v) : localStorage.removeItem('tq_token'); },
  get refresh() { return localStorage.getItem('tq_refresh'); },
  set refresh(v) { v ? localStorage.setItem('tq_refresh', v) : localStorage.removeItem('tq_refresh'); },
};

export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details || {};
  }
}

let refreshing = null;

async function request(path, { method = 'GET', body, params, raw = false, retry = true } = {}) {
  const url = new URL(BASE + path, window.location.origin);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, v);
    }
  }

  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (store.token) headers.Authorization = `Bearer ${store.token}`;

  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  // access token หมดอายุ -> ลองต่ออายุด้วย refresh token หนึ่งครั้ง
  if (res.status === 401 && retry && store.refresh) {
    refreshing ??= fetch(`${BASE}/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refresh_token: store.refresh }),
    })
      .then((r) => (r.ok ? r.json() : null))
      .finally(() => { refreshing = null; });

    const refreshed = await refreshing;
    if (refreshed?.token) {
      store.token = refreshed.token;
      return request(path, { method, body, params, raw, retry: false });
    }
    store.token = null;
    store.refresh = null;
  }

  if (raw) {
    if (!res.ok) throw new ApiError(res.status, 'ดาวน์โหลดไม่สำเร็จ');
    return res;
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, data.error || 'เกิดข้อผิดพลาด', data.details);
  return data;
}

export const api = {
  get:   (p, params) => request(p, { params }),
  post:  (p, body)   => request(p, { method: 'POST', body }),
  put:   (p, body)   => request(p, { method: 'PUT', body }),
  patch: (p, body)   => request(p, { method: 'PATCH', body }),
  del:   (p)         => request(p, { method: 'DELETE' }),
  raw:   (p, params) => request(p, { params, raw: true }),
  tokens: store,
};

/** ดาวน์โหลดไฟล์ CSV จาก endpoint รายงาน */
export async function downloadCsv(path, params, filename) {
  const res = await api.raw(path, params);
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(url);
}
