/**
 * ตรวจสลิปโอนเงินอัตโนมัติ
 *
 *  SLIP_PROVIDER=easyslip  -> ใช้ EasySlip API (https://easyslip.com) ต้องมี EASYSLIP_API_KEY
 *  SLIP_PROVIDER=mock      -> จำลองว่าสลิปถูกต้องเสมอ (ใช้ทดสอบตอนพัฒนาเท่านั้น)
 *
 * ทุก provider คืนค่ารูปแบบเดียวกัน:
 *   { transRef, amount, paidAt: Date|null, receiver: { name, account }, raw }
 * หรือ throw SlipError พร้อมข้อความภาษาไทยที่แสดงให้ลูกค้าเห็นได้
 */
import crypto from 'node:crypto';
import { config } from '../config.js';

export class SlipError extends Error {
  constructor(message, code = 'invalid_slip', retryable = false) {
    super(message);
    this.code = code;
    this.retryable = retryable;
  }
}

const ERROR_TH = {
  SLIP_NOT_FOUND: 'ไม่พบข้อมูลสลิปนี้ในระบบธนาคาร กรุณาตรวจสอบว่าอัปโหลดสลิปที่ถูกต้อง',
  slip_not_found: 'ไม่พบข้อมูลสลิปนี้ในระบบธนาคาร กรุณาตรวจสอบว่าอัปโหลดสลิปที่ถูกต้อง',
  INVALID_IMAGE: 'อ่าน QR บนสลิปไม่ได้ กรุณาอัปโหลดภาพสลิปที่ชัดเจนและไม่ถูกครอป',
  invalid_image: 'อ่าน QR บนสลิปไม่ได้ กรุณาอัปโหลดภาพสลิปที่ชัดเจนและไม่ถูกครอป',
  qrcode_not_found: 'ไม่พบ QR Code บนสลิป กรุณาอัปโหลดภาพสลิปฉบับเต็ม',
  INVALID_PAYLOAD: 'ข้อมูล QR บนสลิปไม่ถูกต้อง',
  invalid_payload: 'ข้อมูล QR บนสลิปไม่ถูกต้อง',
  image_size_too_large: 'ไฟล์รูปใหญ่เกินไป (ไม่เกิน 4MB)',
  DUPLICATE_SLIP: 'สลิปนี้ถูกใช้ไปแล้ว',
  duplicate_slip: 'สลิปนี้ถูกใช้ไปแล้ว',
  QUOTA_EXCEEDED: 'ระบบตรวจสลิปใช้งานครบโควตาแล้ว กรุณาแจ้งพนักงาน',
  quota_exceeded: 'ระบบตรวจสลิปใช้งานครบโควตาแล้ว กรุณาแจ้งพนักงาน',
  UNAUTHORIZED: 'ตั้งค่า API ตรวจสลิปไม่ถูกต้อง กรุณาแจ้งพนักงาน',
  unauthorized: 'ตั้งค่า API ตรวจสลิปไม่ถูกต้อง กรุณาแจ้งพนักงาน',
  access_denied: 'ตั้งค่า API ตรวจสลิปไม่ถูกต้อง กรุณาแจ้งพนักงาน',
};

/** แยก data URL -> base64 ล้วน */
function toBase64(image) {
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(image || '');
  const b64 = m ? m[1] : String(image || '');
  if (!b64 || b64.length < 100) throw new SlipError('กรุณาแนบรูปสลิป', 'no_image');
  // base64 4MB ~ 5.4M ตัวอักษร
  if (b64.length > 5_600_000) throw new SlipError(ERROR_TH.image_size_too_large, 'too_large');
  return b64;
}

// รับเฉพาะรูปบิตแมป ไม่รับ SVG (มีสคริปต์ได้) เพราะพนักงานเปิดดูรูปนี้ในเบราว์เซอร์
const SLIP_MAGIC = [
  ['image/jpeg', (h) => h.startsWith('ffd8ff')],
  ['image/png', (h) => h.startsWith('89504e47')],
  ['image/gif', (h) => h.startsWith('47494638')],
  ['image/webp', (h) => h.startsWith('52494646') && h.slice(16, 24) === '57454250'],
];

/** data URL / base64 -> { mime, buf } หรือ null ถ้าไม่ใช่รูปที่รับได้ (ดู mime จาก magic bytes ไม่เชื่อ client) */
export function decodeSlipImage(image) {
  if (typeof image !== 'string' || !image) return null;
  const m = /^data:image\/[a-z0-9.+-]+;base64,(.+)$/i.exec(image);
  const buf = Buffer.from(m ? m[1] : image, 'base64');
  if (buf.length < 64) return null;
  const hex = buf.subarray(0, 12).toString('hex');
  const mime = SLIP_MAGIC.find(([, test]) => test(hex))?.[0];
  return mime ? { mime, buf } : null;
}

const pick = (...vals) => vals.find((v) => v !== undefined && v !== null && v !== '');

/** ดึงค่าจาก response ให้ทนต่อความต่างเล็กน้อยระหว่าง API v1 / v2 */
function normalizeEasySlip(json) {
  const data = json?.data || {};
  const slip = data.rawSlip || data.slip || data;
  const amountRaw = typeof slip.amount === 'object' ? pick(slip.amount?.amount, slip.amount?.local?.amount) : slip.amount;
  const recvAcc = slip.receiver?.account || {};
  return {
    transRef: pick(slip.transRef, slip.transactionId, slip.ref),
    amount: Number(amountRaw),
    paidAt: slip.date ? new Date(slip.date) : null,
    isDuplicate: data.isDuplicate === true,
    receiver: {
      name: pick(recvAcc.name?.th, recvAcc.name?.en, typeof recvAcc.name === 'string' ? recvAcc.name : null),
      // เลขพร้อมเพย์ปลายทาง (ใช้เทียบกับ PROMPTPAY_ID ได้) — เลขบัญชีธนาคารเก็บแยกไว้ดูเฉย ๆ
      account: pick(recvAcc.proxy?.account, slip.receiver?.proxy?.account),
      bankAccount: recvAcc.bank?.account ?? null,
    },
    raw: slip,
  };
}

async function verifyEasySlip({ base64, expectedAmount }) {
  if (!config.payment.easyslipKey) {
    throw new SlipError('ยังไม่ได้ตั้งค่า EASYSLIP_API_KEY กรุณาแจ้งพนักงาน', 'not_configured');
  }

  let res;
  try {
    res = await fetch(config.payment.easyslipUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.payment.easyslipKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        base64,
        image: base64,          // v1 ใช้ชื่อ field นี้
        checkDuplicate: true,
        matchAmount: Number(expectedAmount),
      }),
      signal: AbortSignal.timeout(20_000),
    });
  } catch (err) {
    throw new SlipError('เชื่อมต่อระบบตรวจสลิปไม่ได้ กรุณาลองใหม่อีกครั้ง', 'network', true);
  }

  const json = await res.json().catch(() => ({}));
  const ok = res.ok && (json.success === true || json.status === 200);
  if (!ok) {
    const code = json?.error?.code || json?.message || `http_${res.status}`;
    throw new SlipError(ERROR_TH[code] || json?.error?.message || 'ตรวจสอบสลิปไม่สำเร็จ', String(code), res.status >= 500);
  }

  const slip = normalizeEasySlip(json);
  if (slip.isDuplicate) throw new SlipError(ERROR_TH.duplicate_slip, 'duplicate_slip');
  return slip;
}

/** โหมดทดสอบ: ถือว่าสลิปถูกต้อง ยอดเงินตรงเสมอ */
async function verifyMock({ base64, expectedAmount }) {
  return {
    transRef: `MOCK${crypto.createHash('sha1').update(base64).digest('hex').slice(0, 16).toUpperCase()}`,
    amount: Number(expectedAmount),
    paidAt: new Date(),
    receiver: { name: config.payment.accountName || 'MOCK', account: config.payment.promptpayId },
    raw: { mock: true },
  };
}

const PROVIDERS = { easyslip: verifyEasySlip, mock: verifyMock };

export const slipProviderName = () => (PROVIDERS[config.payment.slipProvider] ? config.payment.slipProvider : 'easyslip');

/**
 * ตรวจสลิป + เช็กเงื่อนไขของร้าน (ยอดเงิน / ผู้รับ / เวลาโอน)
 * @param {{ image: string, expectedAmount: number, notBefore: Date }} p
 */
export async function verifySlip({ image, expectedAmount, notBefore }) {
  const base64 = toBase64(image);
  const provider = PROVIDERS[slipProviderName()];
  const slip = await provider({ base64, expectedAmount });

  if (!slip.transRef) throw new SlipError('อ่านเลขอ้างอิงธุรกรรมจากสลิปไม่ได้', 'no_trans_ref');

  // 1) ยอดเงินต้องไม่น้อยกว่าที่ต้องจ่าย
  if (!(slip.amount >= Number(expectedAmount) - 0.001)) {
    throw new SlipError(`ยอดเงินในสลิป (${slip.amount} บาท) ไม่ตรงกับยอดที่ต้องชำระ (${expectedAmount} บาท)`, 'amount_mismatch');
  }

  // 2) ต้องเป็นการโอนหลังจากสร้างรายการชำระเงิน (กันเอาสลิปเก่ามาใช้)
  if (notBefore && slip.paidAt && !Number.isNaN(slip.paidAt.getTime())
      && slip.paidAt.getTime() < notBefore.getTime() - 5 * 60_000) {
    throw new SlipError('สลิปนี้เป็นการโอนก่อนเวลาที่สร้างรายการชำระเงิน กรุณาใช้สลิปของรายการนี้', 'slip_too_old');
  }

  // 3) ผู้รับต้องเป็นร้าน — ธนาคารมักปิดเลขบางส่วน จึงเทียบเฉพาะตัวเลขท้ายที่มองเห็น
  if (config.payment.checkReceiver && config.payment.promptpayId) {
    const shown = String(slip.receiver?.account || '').replace(/[^0-9]/g, '');
    const tail = shown.slice(-4);
    const norm = (v) => String(v || '').replace(/\s+|นาย|นางสาว|นาง|MR\.?|MRS\.?|MS\.?/gi, '').toLowerCase();
    const shopName = norm(config.payment.accountName);
    const slipName = norm(slip.receiver?.name);
    const nameMatches = shopName && slipName && (shopName.includes(slipName.slice(0, 6)) || slipName.includes(shopName.slice(0, 6)));

    if (tail.length >= 3) {
      if (!config.payment.promptpayId.endsWith(tail)) {
        throw new SlipError('บัญชีผู้รับเงินในสลิปไม่ใช่บัญชีของร้าน', 'receiver_mismatch');
      }
    } else if (!nameMatches) {
      // อ่านผู้รับจากสลิปไม่ได้ -> ไม่ยอมรับอัตโนมัติ (กันสลิปโอนให้คนอื่นที่ยอดตรงกัน)
      throw new SlipError('ตรวจสอบบัญชีผู้รับเงินในสลิปไม่ได้ กรุณาแจ้งพนักงานเพื่อยืนยันการชำระเงิน', 'receiver_unknown');
    }
  }

  return slip;
}
