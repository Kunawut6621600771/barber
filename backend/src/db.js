import pg from 'pg';
import { config } from './config.js';

// คืนค่า NUMERIC เป็น number แทน string เพื่อให้ frontend ใช้งานง่าย
pg.types.setTypeParser(1700, (v) => (v === null ? null : parseFloat(v)));
// BIGINT (int8) -> number  (ปริมาณข้อมูลระดับร้านตัดผมไม่เกิน MAX_SAFE_INTEGER)
pg.types.setTypeParser(20, (v) => (v === null ? null : parseInt(v, 10)));
// DATE -> 'YYYY-MM-DD' ตามเวลาเครื่อง ไม่แปลงเป็น UTC
pg.types.setTypeParser(1082, (v) => v);

export const pool = new pg.Pool({
  ...config.db,
  // บังคับ timezone ของทุก session ให้เป็นเขตเวลาของร้าน
  // ไม่งั้น CURRENT_DATE ของฐานข้อมูล (มัก UTC) จะไม่ตรงกับ "วันนี้" ฝั่งแอป
  options: `-c timezone=${config.timezone}`,
  max: 10,
  idleTimeoutMillis: 30_000,
});

/** วันที่ "วันนี้" ตามเขตเวลาของร้าน รูปแบบ YYYY-MM-DD (ตรงกับ CURRENT_DATE ของ DB) */
export const shopToday = () =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date());

/** วันที่ย้อนหลัง n วันจากวันนี้ ตามเขตเวลาของร้าน */
export const shopDaysAgo = (n) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: config.timezone,
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).format(new Date(Date.now() - n * 86_400_000));

pool.on('error', (err) => {
  console.error('[db] unexpected pool error', err);
});

export const query = (text, params) => pool.query(text, params);

/** รัน callback ภายใน transaction เดียว (commit/rollback ให้อัตโนมัติ) */
export async function withTransaction(fn) {
  const client = await pool.connect();
  const afterCommit = [];
  client.afterCommit = afterCommit;
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    runAfterCommit(afterCommit);
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    delete client.afterCommit;
    client.release();
  }
}

/**
 * งานที่ต้องทำ "หลัง" commit เท่านั้น เช่น ส่งข้อความ LINE
 * (ไม่อยากให้ลูกค้าได้ข้อความ ถ้า transaction ถูก rollback ภายหลัง)
 * ถ้าไม่ได้อยู่ใน transaction จะรันทันที
 */
export function onCommit(client, fn) {
  if (client?.afterCommit) client.afterCommit.push(fn);
  else runAfterCommit([fn]);
}

function runAfterCommit(fns) {
  for (const fn of fns) {
    setImmediate(() => {
      Promise.resolve()
        .then(fn)
        .catch((err) => console.error('[afterCommit]', err.message));
    });
  }
}
