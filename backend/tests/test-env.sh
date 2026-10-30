# ค่าสภาพแวดล้อมทดสอบ — แยกจากระบบจริง (ฐานข้อมูล / พอร์ต / ไม่ส่ง LINE)
# ใช้: source backend/tests/test-env.sh
export NODE_ENV=test
export PGDATABASE=barbershop_test
export PORT=5051
export CLIENT_URL=http://localhost:3001
export SLIP_PROVIDER=mock
export PAYMENT_REQUIRED=false
export LINE_CHANNEL_ACCESS_TOKEN=
export LINE_CHANNEL_SECRET=
export LINE_LOGIN_CHANNEL_ID=
export LIFF_ID=
export EASYSLIP_API_KEY=
