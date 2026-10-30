import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import helmet from 'helmet';
import compression from 'compression';
import rateLimit from 'express-rate-limit';
import { config } from './config.js';
import { pool } from './db.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { webhook as lineWebhook } from './controllers/line.controller.js';

const app = express();

app.set('trust proxy', 1);
app.disable('x-powered-by');

// ปิด CSP เพื่อไม่ให้ชน LIFF SDK / รูปโปรไฟล์ LINE ที่โหลดจากโดเมนของ LINE
app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } }));
app.use(compression());
app.use(cors({ origin: config.clientUrl.split(',').map((s) => s.trim()), credentials: true }));

// LINE webhook ต้องใช้ raw body เพื่อตรวจลายเซ็น จึงต้องประกาศก่อน express.json()
app.post('/api/line/webhook', express.raw({ type: '*/*', limit: '1mb' }), lineWebhook);
// 8mb เผื่อรูปสลิปที่ส่งมาเป็น base64
app.use(express.json({ limit: '8mb' }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

/* ------------------------- Rate limiting -------------------------- */
const limiter = (windowMs, max, message) => rateLimit({
  windowMs,
  max,
  standardHeaders: true,
  legacyHeaders: false,
  // SSE เปิดค้างไว้ตลอด ไม่ควรโดนนับ
  // ชุดทดสอบอัตโนมัติ (NODE_ENV=test) สมัคร/ล็อกอินถี่ จึงไม่จำกัดเฉพาะตอนทดสอบ
  skip: (req) => req.path === '/notifications/stream' || config.env === 'test',
  message: { error: message },
});

// เดารหัสผ่าน / สแปมสมัครสมาชิก
app.use('/api/auth/login', limiter(15 * 60_000, 20, 'พยายามเข้าสู่ระบบบ่อยเกินไป กรุณารอสักครู่'));
app.use('/api/auth/register', limiter(60 * 60_000, 10, 'สมัครสมาชิกบ่อยเกินไป กรุณารอสักครู่'));
app.use('/api/auth/forgot-password', limiter(60 * 60_000, 10, 'ขอรีเซ็ตรหัสผ่านบ่อยเกินไป กรุณารอสักครู่'));
// กันยิง API รัว ๆ ทั้งระบบ (เผื่อหน้าจอที่ดึงข้อมูลถี่ไว้พอสมควร)
app.use('/api', limiter(60_000, 600, 'มีคำขอเข้ามามากเกินไป กรุณารอสักครู่'));

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now, current_database() AS db');
    res.json({ status: 'ok', database: rows[0].db, time: rows[0].now });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'เชื่อมต่อฐานข้อมูลไม่ได้', detail: err.message });
  }
});

app.use('/api', routes);

// production บนโฮสต์ที่รันได้แค่ Node app เดียว (เช่น Hostinger) -> เสิร์ฟหน้าเว็บที่ build แล้วด้วย
const webDist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend/dist');
if (config.env === 'production' && fs.existsSync(path.join(webDist, 'index.html'))) {
  app.use(express.static(webDist, { index: false, maxAge: '7d' }));
  // เส้นทางของ React Router ทุกหน้า (ยกเว้น /api) ส่ง index.html
  app.get(/^\/(?!api(\/|$)).*/, (_req, res) => res.sendFile(path.join(webDist, 'index.html'), { maxAge: 0 }));
}

app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`\n  ระบบเรียกคิวร้านตัดผม - API`);
  console.log(`  ▸ http://localhost:${config.port}/api`);
  console.log(`  ▸ database: ${config.db.connectionString ? `DATABASE_URL (${new URL(config.db.connectionString).host})` : `${config.db.database}@${config.db.host}:${config.db.port}`}`);
  console.log(`  ▸ client  : ${config.clientUrl}`);
  console.log(`  ▸ payment : ${config.payment.promptpayId ? `PromptPay ${config.payment.required ? '(บังคับจ่ายก่อนรับคิว)' : '(ไม่บังคับ)'} · ตรวจสลิป: ${config.payment.slipProvider}` : 'ยังไม่ได้ตั้ง PROMPTPAY_ID'}`);
  console.log(`  ▸ LINE    : bot ${config.line.channelAccessToken ? 'พร้อม' : 'ยังไม่ตั้งค่า'} · LIFF ${config.line.liffId ? 'พร้อม' : 'ยังไม่ตั้งค่า'}\n`);
});

// SSE ต้องไม่ถูกตัดด้วย timeout ปกติของ Node
server.headersTimeout = 0;
server.requestTimeout = 0;

const shutdown = async (signal) => {
  console.log(`\n[${signal}] shutting down...`);
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
  setTimeout(() => process.exit(1), 10_000).unref();
};
process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));

export default app;
