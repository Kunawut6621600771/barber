/**
 * อัปเดตฐานข้อมูลเดิมให้มีตาราง/คอลัมน์ของฟีเจอร์ใหม่ โดยไม่ลบข้อมูล
 *
 *   npm run db:migrate
 */
import pg from 'pg';
import { config } from '../src/config.js';
import { runMigrations } from './migrate.js';

const client = new pg.Client({ ...config.db, options: `-c timezone=${config.timezone}` });

try {
  await client.connect();
  await runMigrations(client);
  console.log('\n✓ อัปเดตฐานข้อมูลเรียบร้อย');
} catch (err) {
  console.error('\n✗ migration ไม่สำเร็จ:', err.message);
  process.exitCode = 1;
} finally {
  await client.end().catch(() => {});
}
