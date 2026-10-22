/**
 * รันไฟล์ database/migrations/*.sql ตามลำดับชื่อไฟล์
 * ทุกไฟล์เขียนแบบรันซ้ำได้ จึงไม่ต้องเก็บประวัติว่ารันไฟล์ไหนไปแล้ว
 *
 * ใช้โดย setup-db.js และ db-migrate.js (npm run db:migrate)
 */
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const migrationsDir = path.resolve(__dirname, '../../database/migrations');

export async function runMigrations(client) {
  let files = [];
  try {
    files = (await fs.readdir(migrationsDir)).filter((f) => f.endsWith('.sql')).sort();
  } catch {
    return;
  }
  for (const file of files) {
    const sql = await fs.readFile(path.join(migrationsDir, file), 'utf8');
    process.stdout.write(`• migration ${file} ... `);
    await client.query(sql);
    console.log('เสร็จ');
  }
}
