/**
 * สร้างฐานข้อมูล + รัน schema.sql และ seed.sql
 * ใช้แทน psql ได้ (ไม่ต้องมี psql ใน PATH)
 *
 *   npm run db:setup            -> สร้าง schema + ใส่ข้อมูลตัวอย่าง
 *   npm run db:setup -- --no-seed
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { config } from '../src/config.js';
import { runMigrations } from './migrate.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbDir = path.resolve(__dirname, '../../database');
const withSeed = !process.argv.includes('--no-seed');

async function run() {
  // 1) เชื่อมต่อ database 'postgres' เพื่อสร้างฐานข้อมูลของระบบ
  const admin = new pg.Client({ ...config.db, database: 'postgres' });
  await admin.connect();

  const { rows } = await admin.query('SELECT 1 FROM pg_database WHERE datname = $1', [config.db.database]);
  if (rows.length) {
    console.log(`• พบฐานข้อมูล "${config.db.database}" อยู่แล้ว`);
  } else {
    await admin.query(`CREATE DATABASE "${config.db.database}" ENCODING 'UTF8'`);
    console.log(`✓ สร้างฐานข้อมูล "${config.db.database}" แล้ว`);
  }
  await admin.end();

  // 2) รัน schema + seed
  // ใช้ timezone เดียวกับที่แอปใช้ เพื่อให้ CURRENT_DATE ใน seed.sql ตรงกับ "วันนี้" ของระบบ
  const client = new pg.Client({ ...config.db, options: `-c timezone=${config.timezone}` });
  await client.connect();

  const files = withSeed ? ['schema.sql', 'seed.sql'] : ['schema.sql'];
  for (const file of files) {
    const sql = await fs.readFile(path.join(dbDir, file), 'utf8');
    process.stdout.write(`• กำลังรัน ${file} ... `);
    await client.query(sql);
    console.log('เสร็จ');
  }

  // 3) รัน migrations (ฟีเจอร์ที่เพิ่มภายหลัง เช่น ชำระเงิน / LINE)
  await runMigrations(client);

  const { rows: counts } = await client.query(
    `SELECT (SELECT COUNT(*) FROM users) AS users,
            (SELECT COUNT(*) FROM services) AS services,
            (SELECT COUNT(*) FROM queue_tickets) AS tickets`,
  );
  console.log('\n✓ ติดตั้งฐานข้อมูลสำเร็จ');
  console.table(counts[0]);
  if (withSeed) {
    console.log('\nบัญชีทดสอบ (รหัสผ่านทุกบัญชี: 123456)');
    console.log('  admin@trimco.local    - ผู้ดูแลระบบ');
    console.log('  staff@trimco.local    - พนักงานหน้าร้าน');
    console.log('  barber1@trimco.local  - ช่างตัดผม');
    console.log('  arin@example.com      - ลูกค้า\n');
  }
  await client.end();
}

run().catch((err) => {
  console.error('\n✗ ติดตั้งฐานข้อมูลไม่สำเร็จ:', err.message);
  if (err.code === 'ECONNREFUSED') {
    console.error('  ตรวจสอบว่า PostgreSQL ทำงานอยู่ และค่าใน backend/.env ถูกต้อง');
  }
  process.exit(1);
});
