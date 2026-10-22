import express from 'express';
import cors from 'cors';
import morgan from 'morgan';
import { config } from './config.js';
import { pool } from './db.js';
import routes from './routes/index.js';
import { notFound, errorHandler } from './middleware/error.js';
import { webhook as lineWebhook } from './controllers/line.controller.js';

const app = express();

app.set('trust proxy', 1);
app.use(cors({ origin: config.clientUrl.split(',').map((s) => s.trim()), credentials: true }));
// LINE webhook ต้องใช้ raw body เพื่อตรวจลายเซ็น จึงต้องประกาศก่อน express.json()
app.post('/api/line/webhook', express.raw({ type: '*/*', limit: '1mb' }), lineWebhook);
// 8mb เผื่อรูปสลิปที่ส่งมาเป็น base64
app.use(express.json({ limit: '8mb' }));
app.use(morgan(config.env === 'production' ? 'combined' : 'dev'));

app.get('/api/health', async (_req, res) => {
  try {
    const { rows } = await pool.query('SELECT NOW() AS now, current_database() AS db');
    res.json({ status: 'ok', database: rows[0].db, time: rows[0].now });
  } catch (err) {
    res.status(503).json({ status: 'error', message: 'เชื่อมต่อฐานข้อมูลไม่ได้', detail: err.message });
  }
});

app.use('/api', routes);
app.use(notFound);
app.use(errorHandler);

const server = app.listen(config.port, () => {
  console.log(`\n  ระบบเรียกคิวร้านตัดผม - API`);
  console.log(`  ▸ http://localhost:${config.port}/api`);
  console.log(`  ▸ database: ${config.db.database}@${config.db.host}:${config.db.port}`);
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
