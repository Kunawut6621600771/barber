# ตั้งค่า QR PromptPay + ตรวจสลิป + LINE Bot / LIFF

เอกสารนี้อธิบายการเปิดใช้ 3 ฟีเจอร์ใหม่

1. **จ่ายเงินด้วย QR PromptPay ตอนรับบัตรคิว** — ลูกค้าเลือกบริการ ระบบสร้าง QR ตามราคา ลูกค้าสแกนจ่ายแล้วอัปโหลดสลิป
2. **ตรวจสลิปอัตโนมัติ** ผ่าน [EasySlip](https://easyslip.com) — ผ่านแล้วออกบัตรคิวให้ทันที
3. **LINE Official Account + LIFF** — ลูกค้าเปิดแอปของร้านได้จากในแชท LINE และได้รับแจ้งเตือนคิวทาง LINE

---

## ขั้นตอนที่ 0 — อัปเดตฐานข้อมูล (ทำครั้งเดียว)

```bash
cd backend
npm run db:migrate
```

คำสั่งนี้เพิ่มตาราง `payments` และคอลัมน์ LINE ในตาราง `users` โดยไม่ลบข้อมูลเดิม และรันซ้ำได้

---

## ขั้นตอนที่ 1 — QR PromptPay (ใช้ได้ทันที)

แก้ `backend/.env`

```env
PROMPTPAY_ID=0812345678        # เบอร์ที่ผูกพร้อมเพย์ของร้าน (หรือเลข 13 หลัก)
PROMPTPAY_NAME=Trim & Co.
PAYMENT_REQUIRED=true
PAYMENT_EXPIRE_MIN=15
SLIP_PROVIDER=mock             # ช่วงทดสอบ — ดูขั้นตอนที่ 2
```

รีสตาร์ต backend แล้วลองล็อกอินเป็นลูกค้า (`arin@example.com` / `123456`) → เมนู **รับบัตรคิว**
→ เลือกบริการ → **ชำระเงิน ฿xxx และรับบัตรคิว** จะเห็น QR PromptPay

ในโหมด `mock` จะมีปุ่ม **🧪 โหมดทดสอบ: ส่งสลิปจำลอง** ไว้ทดลองขั้นตอนทั้งหมดโดยไม่ต้องโอนเงินจริง

> ⚠️ อย่าลืมเปลี่ยนเป็น `SLIP_PROVIDER=easyslip` ก่อนใช้งานจริง (ถ้าตั้ง `NODE_ENV=production`
> ระบบจะไม่ยอมเปิดในโหมด mock)

**ฝั่งพนักงาน** มีเมนูใหม่ **การชำระเงิน** ใช้ดูรายการทั้งหมดของวัน และกด **รับเงินสด** /
**ยืนยันโอน** ให้ลูกค้าเองได้ เช่น กรณีระบบตรวจสลิปขัดข้อง

---

## ขั้นตอนที่ 2 — ตรวจสลิปอัตโนมัติด้วย EasySlip

1. สมัครที่ <https://easyslip.com> แล้วเข้า Developer Portal
2. สร้าง API key (ถ้าเปิด IP whitelist ให้ใส่ IP ของเครื่องที่รัน backend)
3. แก้ `backend/.env`

   ```env
   SLIP_PROVIDER=easyslip
   EASYSLIP_API_KEY=ใส่คีย์ที่ได้
   ```

ระบบจะตรวจให้อัตโนมัติว่า

- สลิปเป็นของจริงในระบบธนาคาร
- ยอดเงินไม่น้อยกว่าราคาบริการ
- ผู้รับเป็นพร้อมเพย์ของร้าน (เทียบเลขท้าย — ปิดได้ด้วย `SLIP_CHECK_RECEIVER=false`)
- โอนหลังจากสร้างรายการ ไม่ใช่สลิปเก่า
- สลิปเดียวใช้ได้ครั้งเดียว (เก็บเลขอ้างอิงธุรกรรมไว้ในฐานข้อมูล)

---

## ขั้นตอนที่ 3 — เปิดเว็บให้เข้าถึงจากอินเทอร์เน็ตแบบ https

LINE เรียก webhook และเปิด LIFF ได้เฉพาะ **https** เท่านั้น ระหว่างพัฒนาใช้ [ngrok](https://ngrok.com) ได้ง่ายที่สุด

1. สมัคร ngrok แล้วติดตั้งตามหน้า Setup & Installation
2. ในหน้า Domains ของ ngrok กดรับโดเมนฟรี 1 ชื่อ (ชื่อจะคงที่ ไม่ต้องแก้ค่าใน LINE ทุกครั้ง)
3. เปิดระบบตามปกติ (`start-system.bat`) แล้วเปิดอีกหน้าต่างหนึ่ง

   ```bash
   ngrok http --url=ชื่อโดเมนของคุณ.ngrok-free.app 3000
   ```

4. แก้ `backend/.env`

   ```env
   PUBLIC_URL=https://ชื่อโดเมนของคุณ.ngrok-free.app
   CLIENT_URL=https://ชื่อโดเมนของคุณ.ngrok-free.app,http://localhost:3000
   ```

ทุกอย่าง (หน้าเว็บ + API + webhook) วิ่งผ่านพอร์ต 3000 เพราะ Vite ส่งต่อ `/api` ไปที่ backend ให้แล้ว

---

## ขั้นตอนที่ 4 — LINE Official Account + Messaging API (บอทแจ้งเตือน)

1. สร้าง LINE Official Account ที่ <https://manager.line.biz>
2. ใน LINE Official Account Manager → **ตั้งค่า** → **Messaging API** → กด **เปิดใช้ Messaging API**
   แล้วเลือก/สร้าง **Provider** (จำชื่อไว้ ต้องใช้ Provider เดียวกันในขั้นตอนที่ 5)
3. ใน **ตั้งค่าการตอบกลับ** ปิด *ข้อความตอบกลับอัตโนมัติ* และ *ข้อความทักทาย* (บอทของระบบตอบเอง) และเปิด **Webhook**
4. เข้า <https://developers.line.biz/console> → Provider → channel ของ OA
   - แท็บ **Basic settings** → คัดลอก **Channel secret**
   - แท็บ **Messaging API** → **Channel access token (long-lived)** กด Issue แล้วคัดลอก
   - แท็บ **Messaging API** → **Bot basic ID** (เช่น `@123abcde`)
   - แท็บ **Messaging API** → **Webhook URL** ใส่

     ```text
     https://ชื่อโดเมนของคุณ.ngrok-free.app/api/line/webhook
     ```

     กด **Verify** (ต้องขึ้น Success) และเปิด **Use webhook**

5. แก้ `backend/.env`

   ```env
   LINE_CHANNEL_SECRET=...
   LINE_CHANNEL_ACCESS_TOKEN=...
   LINE_BOT_BASIC_ID=@123abcde
   ```

---

## ขั้นตอนที่ 5 — LINE Login + LIFF (เปิดแอปในไลน์)

1. ใน LINE Developers Console → **Provider เดียวกับ OA** → **Create a new channel** → **LINE Login**
   - App types: เลือก **Web app**
2. แท็บ **Basic settings**
   - คัดลอก **Channel ID** → ใส่ `LINE_LOGIN_CHANNEL_ID`
   - **Linked LINE Official Account** → เลือก OA ของร้าน
3. แท็บ **LIFF** → **Add**
   - LIFF app name: `Trim & Co.`
   - Size: **Full**
   - Endpoint URL: `https://ชื่อโดเมนของคุณ.ngrok-free.app/liff`
   - Scopes: ติ๊ก **openid** และ **profile** (ติ๊ก email ด้วยก็ได้ถ้าได้รับอนุมัติ)
   - Add friend option: **On (Aggressive)** — ชวนลูกค้าเพิ่มเพื่อน OA ตอนเปิดแอปครั้งแรก
   - กด Add แล้วคัดลอก **LIFF ID** → ใส่ `LIFF_ID`
4. ช่องสถานะด้านบนของ channel ต้องเปลี่ยนจาก **Developing** เป็น **Published**
   (ถ้ายังเป็น Developing จะล็อกอินได้เฉพาะบัญชีที่เป็นแอดมิน/tester ของ channel)

```env
LINE_LOGIN_CHANNEL_ID=1234567890
LIFF_ID=1234567890-AbCdEfGh
```

รีสตาร์ต backend — บรรทัด `▸ LINE : bot พร้อม · LIFF พร้อม` ควรขึ้นในหน้าต่าง Backend

### สร้างเมนูในห้องแชท (Rich menu)

```bash
cd backend
npm run line:richmenu
```

จะได้เมนู 3 ปุ่มใต้ห้องแชท: **รับบัตรคิว** (เปิดแอป) · **คิวของฉัน** · **คิวตอนนี้**
(รูปเมนูอยู่ที่ `backend/assets/richmenu.png` เปลี่ยนเป็นรูปของร้านได้ ขนาด 2500×843 px)

---

## การทำงานของระบบ

```text
ลูกค้าเพิ่มเพื่อน OA ──► บอททักทาย + ปุ่ม "เปิดแอป / รับบัตรคิว"
        │
        ▼
https://liff.line.me/<LIFF_ID>?to=/app/take-queue
        │  (หน้า /liff ตรวจ ID token กับ LINE)
        ├─ เคยผูกแล้ว ─► เข้าสู่ระบบอัตโนมัติ
        └─ ครั้งแรก ──► "เริ่มใช้งานด้วยบัญชี LINE" หรือ "เข้าสู่ระบบบัญชีเดิมเพื่อเชื่อม"
        │
        ▼
เลือกบริการ ─► QR PromptPay ─► อัปโหลดสลิป ─► EasySlip ตรวจ ─► ออกบัตรคิว
        │                                                     │
        │                                   LINE: "ชำระเงินสำเร็จ ได้คิว B-012"
        ▼
พนักงานกดเรียกคิว ──► LINE: "ใกล้ถึงคิว" / "ถึงคิวแล้ว" / "ให้บริการเสร็จสิ้น"
```

ลูกค้าที่สมัครด้วยอีเมลอยู่แล้วเชื่อม LINE ได้จากหน้า **ข้อมูลส่วนตัว** → **เชื่อมบัญชี LINE**

ข้อความในแชทที่บอทเข้าใจ: `คิวของฉัน`, `คิวตอนนี้`, `รับคิว`

## API ที่เพิ่มเข้ามา

| Method | Path | สิทธิ์ | หน้าที่ |
|--------|------|--------|--------|
| GET | `/api/payments/config` | ล็อกอิน | ค่าการชำระเงินของร้าน |
| POST | `/api/payments` | ลูกค้า | สร้างรายการ + QR PromptPay |
| GET | `/api/payments/current` | ลูกค้า | รายการที่ค้างจ่าย |
| GET | `/api/payments/:id` | เจ้าของ/พนักงาน | สถานะรายการ |
| POST | `/api/payments/:id/slip` | เจ้าของ | อัปโหลดสลิป `{ image: dataURL }` |
| POST | `/api/payments/:id/cancel` | เจ้าของ/พนักงาน | ยกเลิกรายการที่ยังไม่จ่าย |
| GET | `/api/payments?date=&status=` | พนักงาน | รายการของวัน + สรุปยอด |
| POST | `/api/payments/:id/approve` | admin/staff | ยืนยันเอง `{ method: 'cash' \| 'manual' }` |
| GET | `/api/line/config` | สาธารณะ | LIFF ID / ลิงก์เพิ่มเพื่อน |
| POST | `/api/line/webhook` | LINE (ตรวจลายเซ็น) | รับ event จาก LINE |
| POST | `/api/auth/line` | สาธารณะ | เข้าสู่ระบบด้วย LINE `{ id_token, create? }` |
| GET/POST/DELETE | `/api/line/me`, `/api/line/link` | ล็อกอิน | ดู/ผูก/ยกเลิกการผูก LINE |

## แก้ปัญหาที่พบบ่อย

| อาการ | สาเหตุ / วิธีแก้ |
|-------|-----------------|
| Verify webhook ไม่ผ่าน | ngrok ไม่ได้เปิด, URL ผิด หรือ `LINE_CHANNEL_SECRET` ไม่ตรง |
| เปิด LIFF แล้วขึ้น "ร้านยังไม่ได้ตั้งค่า LIFF" | ยังไม่ได้ใส่ `LIFF_ID` / `LINE_LOGIN_CHANNEL_ID` หรือยังไม่รีสตาร์ต backend |
| เปิด LIFF แล้วขึ้น Blocked request / host not allowed | ใช้ `vite.config.js` เวอร์ชันใหม่ (มี `allowedHosts: true`) แล้วรีสตาร์ต frontend |
| ล็อกอิน LINE แล้วขึ้น 401 | Channel ID ไม่ตรงกับ channel ที่มี LIFF หรือ channel ยังเป็น Developing |
| ลูกค้าไม่ได้รับข้อความ | ลูกค้ายังไม่เพิ่มเพื่อน/บล็อก OA หรือโควตาข้อความ push ของแพ็กเกจ OA หมด |
| ตรวจสลิปขึ้น "บัญชีผู้รับไม่ใช่ของร้าน" | `PROMPTPAY_ID` ไม่ตรงกับบัญชีที่ลูกค้าโอนเข้า (หรือปิดการเทียบด้วย `SLIP_CHECK_RECEIVER=false`) |

---

## ผูกบัญชี LINE ด้วยการสแกน QR (วิธีที่ลูกค้าใช้จริงหน้าร้าน)

เดิมลูกค้าต้องเปิดแอปจากในไลน์ (LIFF) ถึงจะผูกบัญชีได้ ซึ่งใช้ไม่ได้ถ้าลูกค้า
กำลังเปิดเว็บอยู่บนคอมพิวเตอร์หรือแท็บเล็ตของร้าน

ตอนนี้ระบบจะแสดง **QR สำหรับผูกบัญชี** ไว้ที่
หน้าชำระเงิน · หน้าหลังรับบัตรคิว · หน้าคิวของฉัน · หน้าข้อมูลส่วนตัว

**ลูกค้าทำแค่ 3 ขั้นตอน**

1. เปิดแอป LINE แล้วสแกน QR บนหน้าจอ
2. กด **เพิ่มเพื่อน** บัญชีทางการของร้าน
3. กด **ส่ง** ข้อความที่ระบบพิมพ์ไว้ให้แล้ว (เช่น `เชื่อมบัญชีคิว LINK-4SBXTU`)

หน้าเว็บจะเปลี่ยนเป็น "เชื่อม LINE เรียบร้อยแล้ว" เองภายในไม่กี่วินาที
โดยไม่ต้องรีเฟรช จากนั้นระบบจะส่งแจ้งเตือนเข้าแชท LINE เมื่อ **ใกล้ถึงคิว** และ **ถึงคิว**

**ต้องตั้งค่าอะไรบ้าง**

| ค่า | จำเป็นไหม | ใช้ทำอะไร |
|---|---|---|
| `LINE_CHANNEL_ACCESS_TOKEN` | ✅ | ส่งข้อความแจ้งเตือน และอ่านโปรไฟล์ลูกค้าตอนผูกบัญชี |
| `LINE_CHANNEL_SECRET` | ✅ | ตรวจลายเซ็น webhook |
| `LINE_BOT_BASIC_ID` | ✅ | ใช้สร้างลิงก์ใน QR เช่น `@123abcde` (ดูได้ที่ LINE OA Manager) |
| `LIFF_ID`, `LINE_LOGIN_CHANNEL_ID` | ไม่จำเป็น | มีไว้เพื่อเปิดแอปในไลน์ได้สวยกว่า ถ้าไม่ตั้งระบบจะใช้ลิงก์เว็บปกติแทน |

ถ้ายังไม่ได้ตั้ง 3 ค่าแรก การ์ด QR จะซ่อนตัวเองอัตโนมัติ ระบบอื่นทำงานปกติทุกอย่าง

**กลไกเบื้องหลัง**

- `GET /api/line/link-qr` สร้างรหัสชั่วคราว (อายุ 30 นาที) ผูกกับผู้ใช้ที่ล็อกอินอยู่
  แล้วคืน QR ของลิงก์ `https://line.me/R/oaMessage/<basic id>/?<ข้อความ>`
- หน้าเว็บถามสถานะซ้ำทุก 4 วินาที จนกว่าจะเห็น `linked: true`
- `POST /api/line/webhook` จับรหัสจากข้อความด้วย regex `LINK-XXXXXX`
  แล้วบันทึก `users.line_user_id` ให้ พร้อมตอบการ์ดยืนยัน (และสถานะคิวปัจจุบัน ถ้ามี)
- รหัสใช้ได้ครั้งเดียว · หมดอายุแล้วใช้ไม่ได้ · บัญชี LINE ที่ผูกกับคนอื่นอยู่แล้วจะถูกปฏิเสธ
  (ตาราง `line_link_tokens` จาก migration `004_line_link_token.sql`)

**บิลรายการในหน้าชำระเงิน**

หน้าชำระเงินแสดงสรุปบิลไว้เหนือ QR PromptPay แล้ว — ชื่อบริการ เวลาที่ใช้ ช่างที่เลือก
ราคา ยอดรวม เลขอ้างอิง และเวลาที่เปิดรายการ ให้ลูกค้าตรวจก่อนโอน
