# ระบบเรียกคิวร้านตัดผม (Barbershop Queue Management System)

ระบบจัดการคิวร้านตัดผมแบบครบวงจร พัฒนาตาม Requirement ในเอกสาร `IT_requirement.pdf`

**Objective** — บริหารจัดการคิวลูกค้าอย่างเป็นระบบ ลดเวลาการรอคิว ลดความผิดพลาดในการเรียกคิว
เพิ่มความสะดวกให้ทั้งลูกค้าและพนักงาน และติดตามสถานะคิวได้แบบ **Real-time**

---

## สถาปัตยกรรมระบบ

| ส่วน | เทคโนโลยี |
|------|-----------|
| Frontend | React 18 + Vite + React Router + Recharts |
| Backend | Node.js + Express (REST API) |
| Database | **PostgreSQL 14+** |
| Auth | JWT (access token) + refresh token, bcrypt |
| Real-time | Server-Sent Events (SSE) |

```
it project/
├── database/
│   ├── schema.sql        โครงสร้างฐานข้อมูล (ตาราง, enum, view, function, trigger)
│   └── seed.sql          ข้อมูลตัวอย่าง (ผู้ใช้ บริการ และคิวย้อนหลัง 14 วัน)
├── backend/
│   ├── scripts/setup-db.js   สคริปต์ติดตั้งฐานข้อมูล (ใช้แทน psql ได้)
│   └── src/
│       ├── server.js         จุดเริ่มต้นของ API
│       ├── db.js             connection pool + helper transaction
│       ├── routes/index.js   นิยาม endpoint ทั้งหมด
│       ├── controllers/      auth, users, barbers, services, queue, dashboard, notifications, reports
│       ├── middleware/        ตรวจสิทธิ์ (JWT + role) และจัดการ error
│       └── utils/            validation, notification, realtime (SSE)
└── frontend/
    └── src/
        ├── pages/            หน้าจอทั้งหมด
        ├── components/       Layout + UI components ที่ใช้ร่วมกัน
        ├── context/          Auth และ Toast
        ├── api/              client เรียก REST API + hook สำหรับ SSE
        └── styles/app.css    design system
```

---

## การติดตั้ง

### 1. ติดตั้ง PostgreSQL

**วิธีที่ใช้อยู่ตอนนี้ — Docker** (container ชื่อ `barbershop-db` ถูกสร้างไว้แล้ว)

```bash
docker run --name barbershop-db -e POSTGRES_PASSWORD=postgres -p 5440:5432 -d postgres:16
```

ครั้งต่อไปแค่สั่งให้ container เดิมทำงานอีกครั้ง:

```bash
docker start barbershop-db
```

หรือถ้าอยากติดตั้งลงเครื่องตรง ๆ ดาวน์โหลดจาก <https://www.postgresql.org/download/windows/>
(จำรหัสผ่านของ user `postgres` ที่ตั้งไว้ตอนติดตั้งด้วย แล้วแก้ `PGPASSWORD` ใน `.env` ให้ตรง)

> **เรื่องเขตเวลา** — PostgreSQL ใน Docker รันเป็น UTC ซึ่งทำให้ `CURRENT_DATE` ไม่ตรงกับ
> "วันนี้" ของประเทศไทย ระบบจึงบังคับ timezone ของทุก session ให้เป็นค่า `SHOP_TIMEZONE`
> ใน `.env` (ค่าเริ่มต้น `Asia/Bangkok`) และคำนวณ "วันนี้" ฝั่ง Node ด้วยเขตเวลาเดียวกัน
> ถ้าย้ายร้านไปเขตเวลาอื่น ให้แก้ค่านี้ค่าเดียว

### 2. ตั้งค่า Backend

```bash
cd backend
npm install
```

คัดลอก `.env.example` เป็น `.env` แล้วแก้ `PGPASSWORD` ให้ตรงกับรหัสผ่าน PostgreSQL ของคุณ

```bash
copy .env.example .env
```

### 3. สร้างฐานข้อมูล + ใส่ข้อมูลตัวอย่าง

```bash
npm run db:setup
```

สคริปต์นี้จะสร้าง database `barbershop` แล้วรัน `schema.sql` และ `seed.sql` ให้อัตโนมัติ
(ถ้าไม่ต้องการข้อมูลตัวอย่าง ใช้ `npm run db:setup -- --no-seed`)

หรือรันด้วย `psql` เองก็ได้:

```bash
psql -U postgres -c "CREATE DATABASE barbershop"
psql -U postgres -d barbershop -f ../database/schema.sql
psql -U postgres -d barbershop -f ../database/seed.sql
```

### 4. เริ่มใช้งาน

เปิด **2 terminal**

```bash
cd backend
npm run dev
```

```bash
cd frontend
npm install
npm run dev
```

เปิดเบราว์เซอร์ที่ <http://localhost:3000>

> **หมายเหตุสำหรับ Windows** — ถ้า `npm install` ที่ frontend ขึ้น error
> `ERR_INVALID_ARG_TYPE ... "file" argument must be of type string`
> แปลว่าตัวแปรระบบ `ComSpec` หายไป ให้รันคำสั่งนี้ก่อนใน PowerShell:
> `$env:ComSpec = "$env:SystemRoot\System32\cmd.exe"`

---

## บัญชีทดสอบ

รหัสผ่านทุกบัญชี: **`123456`**

| อีเมล | บทบาท | เข้าถึงได้ |
|-------|--------|-----------|
| `admin@trimco.local` | ผู้ดูแลระบบ | ทุกฟังก์ชัน รวมถึงลบผู้ใช้/บริการ |
| `staff@trimco.local` | พนักงานหน้าร้าน | จัดการคิว ผู้ใช้ บริการ รายงาน |
| `barber1@trimco.local` | ช่างตัดผม | จัดการคิว ดูรายงาน อัปเดตสถานะตนเอง |
| `arin@example.com` | ลูกค้า | รับบัตรคิว ดูคิวตนเอง ยกเลิกคิว |

---

## หน้าจอในระบบ

| เส้นทาง | คำอธิบาย | สิทธิ์ |
|---------|----------|--------|
| `/login`, `/register` | เข้าสู่ระบบ / สมัครสมาชิก | สาธารณะ |
| `/forgot-password`, `/reset-password` | ลืมรหัสผ่าน / ตั้งรหัสผ่านใหม่ | สาธารณะ |
| `/board` | **จอแสดงคิวหน้าร้าน** อัปเดตเรียลไทม์ | สาธารณะ |
| `/track/:token` | **ติดตามคิวผ่าน QR Code** | สาธารณะ |
| `/app/dashboard` | ภาพรวมประจำวัน + กราฟ | พนักงาน |
| `/app/queue` | จัดการคิว (เรียก/ข้าม/ยกเลิก/เรียกซ้ำ) | พนักงาน |
| `/app/users` | จัดการผู้ใช้ ลูกค้า พนักงาน ช่าง | admin, staff |
| `/app/services` | จัดการบริการ ประเภท ราคา ระยะเวลา | ทุกคน (แก้ไขได้เฉพาะ admin/staff) |
| `/app/reports` | รายงาน 3 ชุด + ส่งออก CSV | พนักงาน |
| `/app/take-queue` | รับบัตรคิว | ลูกค้า |
| `/app/my-queue` | คิวของฉัน + เหลืออีกกี่คิว | ลูกค้า |
| `/app/profile` | ข้อมูลส่วนตัว + เปลี่ยนรหัสผ่าน + ตั้งค่าแจ้งเตือน | ทุกคน |

---

## Requirement ↔ การพัฒนา

### Module Authentication
| Requirement | ที่อยู่ในระบบ |
|---|---|
| Login | `POST /api/auth/login` · หน้า `/login` |
| Logout | `POST /api/auth/logout` (เพิกถอน refresh token) |
| Change Password | `POST /api/auth/change-password` · หน้า `/app/profile` |
| Forgot Password | `POST /api/auth/forgot-password` · หน้า `/forgot-password` |
| Create Password | `POST /api/auth/reset-password` (รองรับทั้งตั้งใหม่และตั้งครั้งแรก) |

### User Management
| Requirement | ที่อยู่ในระบบ |
|---|---|
| จัดการข้อมูลลูกค้า | `GET/POST/PUT/DELETE /api/users` (กรอง `role=customer`) |
| เพิ่ม / แก้ไข / ลบข้อมูลลูกค้า | หน้า `/app/users` |
| จัดการข้อมูลพนักงาน | `role=staff` / `role=admin` ในหน้าเดียวกัน |
| จัดการข้อมูลช่างตัดผม | `GET /api/barbers`, `PUT /api/barbers/:id` (รหัสช่าง ความถนัด สถานะ) |
| จัดการข้อมูลส่วนตัว | `PUT /api/users/me` · หน้า `/app/profile` |

### Queue Management
| Requirement | ที่อยู่ในระบบ |
|---|---|
| รับบัตรคิว | `POST /api/queue` (หน้าร้าน / QR / ออนไลน์) |
| เรียกคิว | `POST /api/queue/call` (คิวถัดไป), `POST /api/queue/:id/call` |
| ข้ามคิว | `POST /api/queue/:id/skip` (เลื่อนท้ายแถว ครบ 2 ครั้ง = ไม่มาตามคิว) |
| ยกเลิกคิว | `POST /api/queue/:id/cancel` (ลูกค้ายกเลิกเองได้) |
| เรียกคิวซ้ำ | `POST /api/queue/:id/recall` (นับ `recall_count`) |
| แสดงคิวปัจจุบัน | `GET /api/queue/current` · หน้า `/board` |
| แสดงจำนวนคิวที่รอ | `waiting_count` ใน `/api/queue/current` และ `/api/queue/my` |
| จัดลำดับคิวอัตโนมัติ | `POST /api/queue/reorder` → PostgreSQL function `reorder_queue()` |
| เปลี่ยนสถานะคิว | `waiting` / `called` / `serving` / `done` / `cancelled` / `skipped` / `no_show` |
| ตรวจสอบลำดับคิวของตนเอง | `GET /api/queue/my`, `GET /api/queue/track/:token` |
| รับบัตรคิวผ่าน QR Code | `GET /api/queue/shop-qr` (QR หน้าร้าน) + QR ติดตามรายใบ |
| ออกหมายเลขคิวอัตโนมัติ | PostgreSQL function `next_ticket_no()` (รีเซ็ตทุกวัน, ล็อกกันเลขชนกัน) |

### Service Management
| Requirement | ที่อยู่ในระบบ |
|---|---|
| จัดการประเภทบริการ | `/api/services/categories` (ตัดผม สระผม โกนหนวด ทำสีผม) |
| เพิ่ม / แก้ไข / ลบบริการ | `POST/PUT/DELETE /api/services` · หน้า `/app/services` |
| กำหนดระยะเวลาแต่ละบริการ | ฟิลด์ `duration_min` |
| กำหนดราคาบริการ | ฟิลด์ `price` |

### Dashboard
| Requirement | ที่อยู่ในระบบ |
|---|---|
| แสดงคิวปัจจุบัน | การ์ด "คิวปัจจุบัน" |
| แสดงคิวที่รอ | การ์ด "คิวที่รอ" |
| แสดงช่างที่กำลังให้บริการ | การ์ด "ช่างที่กำลังให้บริการ" (สถานะ + คิวที่ทำอยู่) |
| แสดงสถิติการให้บริการประจำวัน | Stat tiles + กราฟแนวโน้ม 14 วัน + กราฟรายชั่วโมง |

### Notification
| Requirement | ที่อยู่ในระบบ |
|---|---|
| แจ้งเตือนเมื่อใกล้ถึงคิว | `near_turn` — ยิงอัตโนมัติเมื่อคิวขยับถึงเกณฑ์ `near_turn_threshold` |
| แจ้งเตือนเมื่อถึงคิว | `your_turn` — ยิงตอนพนักงานกดเรียกคิว |
| แจ้งเตือนเมื่อยกเลิกคิว | `cancelled` — ยิงตอนคิวถูกยกเลิก |
| (เพิ่มเติม) | `skipped`, `called_again`, `done` + ผู้ใช้เปิด/ปิดได้เองที่หน้าโปรไฟล์ |

### Report Management
| Requirement | ที่อยู่ในระบบ |
|---|---|
| รายงานจำนวนลูกค้า | `GET /api/reports/customers` (รายวัน + ลูกค้าประจำ + ช่องทางรับคิว) |
| รายงานเวลารอเฉลี่ย | `GET /api/reports/wait-time` (รายวัน + รายชั่วโมง + แยกตามบริการ) |
| รายงานการให้บริการของช่าง | `GET /api/reports/barbers` (จำนวนคิว รายได้ เวลาเฉลี่ย) |
| ส่งออกข้อมูล | `GET /api/reports/export?type=...` → CSV (มี BOM ให้ Excel อ่านภาษาไทยได้) |

---

## โครงสร้างฐานข้อมูล

**ตาราง**

| ตาราง | หน้าที่ |
|-------|--------|
| `users` | ผู้ใช้ทุกบทบาท + ค่าตั้งการแจ้งเตือน |
| `refresh_tokens` | เซสชันการเข้าสู่ระบบ (ใช้ตอน Logout) |
| `password_resets` | token สำหรับ Forgot / Create Password |
| `barbers` | ข้อมูลช่างตัดผม (ขยายจาก `users`) |
| `service_categories`, `services` | ประเภทบริการ และบริการ (ระยะเวลา + ราคา) |
| `barber_services` | ช่างคนไหนทำบริการอะไรได้ |
| `queue_tickets` | บัตรคิว (หัวใจของระบบ) |
| `queue_events` | ประวัติการเปลี่ยนสถานะคิว ใช้ทำรายงาน |
| `notifications` | การแจ้งเตือนของผู้ใช้ |
| `shop_settings` | ค่าคอนฟิกร้าน เช่น เกณฑ์แจ้งเตือนใกล้ถึงคิว |

**Function**

- `next_ticket_no(date)` — ออกเลขคิวอัตโนมัติ รีเซ็ตทุกวัน ใช้ advisory lock กันเลขชนกัน
- `reorder_queue(date)` — จัดลำดับคิวอัตโนมัติ (`priority` → คิวที่ถูกข้ามน้อยกว่า → เวลารับบัตร)
- `estimate_wait_minutes(date, position)` — ประมาณเวลารอจากบริการที่ค้างอยู่หารด้วยจำนวนช่าง

**View**

- `v_queue_board` — คิวพร้อมข้อมูลลูกค้า บริการ และช่าง (ใช้แทบทุกหน้าจอ)
- `v_daily_stats` — สถิติรายวัน (จำนวนคิว เวลารอเฉลี่ย รายได้)
- `v_barber_performance` — ผลงานของช่างแต่ละคน

**ข้อจำกัดสำคัญที่บังคับในระดับฐานข้อมูล**

- ลูกค้า 1 คน มีคิวที่ยัง active ได้แค่ 1 ใบต่อวัน (partial unique index)
- เลขคิวและลำดับห้ามซ้ำภายในวันเดียวกัน
- แจ้งเตือนชนิด `near_turn` / `your_turn` / `cancelled` ยิงซ้ำต่อคิวไม่ได้

---

## หมายเหตุด้านความปลอดภัย

- รหัสผ่านเก็บด้วย bcrypt (cost 10) ไม่เก็บ plaintext
- refresh token เก็บเป็น SHA-256 hash ในฐานข้อมูล
- เปลี่ยนรหัสผ่าน / รีเซ็ตรหัสผ่าน จะเพิกถอนทุกเซสชันเดิม
- ข้อความตอนล็อกอินผิดเหมือนกันทั้งกรณีอีเมลผิดและรหัสผ่านผิด (กันการเดาว่ามีอีเมลนี้ในระบบ)
- ทุก query ใช้ parameterized statement ป้องกัน SQL injection
- ก่อนใช้งานจริง: ตั้ง `JWT_SECRET` เป็นค่าสุ่มยาว ๆ และเปลี่ยนรหัสผ่านบัญชีทดสอบทั้งหมด

## สิ่งที่ยังไม่ได้ต่อของจริง

- **การส่งอีเมล** — ลิงก์รีเซ็ตรหัสผ่านยัง `console.log` ไว้ฝั่ง server (และส่งกลับมาแสดงบนหน้าจอเฉพาะโหมด dev)
  ถ้าจะใช้จริงให้ต่อ SMTP/SendGrid ที่ `backend/src/controllers/auth.controller.js` ฟังก์ชัน `forgotPassword`
- **SMS** — โครงสร้าง `notifications.channel` รองรับไว้แล้ว จุดต่อคือ `backend/src/utils/notify.js`

## ชำระเงิน QR PromptPay + LINE Bot / LIFF

- ลูกค้าเลือกบริการ → สแกน QR PromptPay ตามราคา → อัปโหลดสลิป → ตรวจอัตโนมัติ (EasySlip) → ได้บัตรคิว
- พนักงานดู/ยืนยันการชำระเงินได้ที่เมนู **การชำระเงิน**
- LINE Official Account แจ้งเตือนใกล้ถึงคิว / ถึงคิว / ชำระเงินสำเร็จ และเปิดแอปในไลน์ผ่าน LIFF (`/liff`)

อัปเดตฐานข้อมูลเดิมด้วย `npm run db:migrate` แล้วดูวิธีตั้งค่าทั้งหมดใน
[docs/LINE_PROMPTPAY_SETUP.md](docs/LINE_PROMPTPAY_SETUP.md)
