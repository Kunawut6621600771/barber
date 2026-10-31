import 'dotenv/config';

export const config = {
  port: Number(process.env.PORT || 5050),
  env: process.env.NODE_ENV || 'development',
  clientUrl: process.env.CLIENT_URL || 'http://localhost:3000',
  // เขตเวลาของร้าน ใช้ทั้งฝั่ง Node และตั้งให้ PostgreSQL session ด้วย
  // เพื่อให้ "วันนี้" ของแอปกับ CURRENT_DATE ของฐานข้อมูลเป็นวันเดียวกันเสมอ
  timezone: process.env.SHOP_TIMEZONE || 'Asia/Bangkok',
  jwt: {
    secret: process.env.JWT_SECRET || 'dev-secret-change-me',
    expiresIn: process.env.JWT_EXPIRES_IN || '8h',
    refreshDays: Number(process.env.REFRESH_EXPIRES_DAYS || 7),
  },
  // ที่อยู่สาธารณะแบบ https (เช่น URL จาก ngrok / cloudflared) ใช้ทำลิงก์ใน LINE
  publicUrl: (process.env.PUBLIC_URL || process.env.CLIENT_URL || 'http://localhost:3000').split(',')[0].trim().replace(/\/$/, ''),
  payment: {
    promptpayId: (process.env.PROMPTPAY_ID || '').replace(/[^0-9]/g, ''),
    accountName: process.env.PROMPTPAY_NAME || '',
    // ลูกค้าต้องจ่ายก่อนจึงจะได้บัตรคิว (พนักงานออกบัตร walk-in ได้ตามปกติ)
    required: (process.env.PAYMENT_REQUIRED ?? 'true') !== 'false' && !!process.env.PROMPTPAY_ID,
    expireMinutes: Number(process.env.PAYMENT_EXPIRE_MIN || 15),
    slipProvider: (process.env.SLIP_PROVIDER || 'easyslip').toLowerCase(), // easyslip | mock
    easyslipKey: process.env.EASYSLIP_API_KEY || '',
    easyslipUrl: process.env.EASYSLIP_API_URL || 'https://developer.easyslip.com/api/v1/verify',
    // ตรวจเลขบัญชี/พร้อมเพย์ปลายทางบนสลิปให้ตรงกับร้าน (เทียบเลขท้ายที่ธนาคารไม่ได้ปิดไว้)
    checkReceiver: (process.env.SLIP_CHECK_RECEIVER ?? 'true') !== 'false',
  },
  line: {
    channelAccessToken: process.env.LINE_CHANNEL_ACCESS_TOKEN || '',
    channelSecret: process.env.LINE_CHANNEL_SECRET || '',
    loginChannelId: process.env.LINE_LOGIN_CHANNEL_ID || '',
    liffId: process.env.LIFF_ID || '',
    botBasicId: process.env.LINE_BOT_BASIC_ID || '',          // เช่น @123abcde ใช้ทำลิงก์เพิ่มเพื่อน
  },
  // ฐานข้อมูลบนคลาวด์ (เช่น Neon) ให้ใส่ DATABASE_URL แทน PGHOST/PGUSER/...
  db: process.env.DATABASE_URL ? { connectionString: process.env.DATABASE_URL } : {
    host: process.env.PGHOST || 'localhost',
    port: Number(process.env.PGPORT || 5440),
    user: process.env.PGUSER || 'postgres',
    password: process.env.PGPASSWORD || 'postgres',
    database: process.env.PGDATABASE || 'barbershop',
  },
};

if (config.env === 'production' && config.payment.slipProvider === 'mock') {
  throw new Error('SLIP_PROVIDER=mock ใช้ได้เฉพาะตอนพัฒนาเท่านั้น');
}

if (config.env === 'production' && config.jwt.secret === 'dev-secret-change-me') {
  throw new Error('JWT_SECRET must be set in production');
}
