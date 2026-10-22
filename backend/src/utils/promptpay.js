/**
 * สร้างข้อความ QR PromptPay ตามมาตรฐาน EMVCo (Thai QR Payment)
 * ใช้ได้กับทุกแอปธนาคารในไทย โดยไม่ต้องพึ่ง library ภายนอก
 *
 *   promptpayPayload('0812345678', 150)  -> '000201010212...6304ABCD'
 *
 * รองรับ: เบอร์มือถือ (10 หลัก), เลขบัตรประชาชน / เลขผู้เสียภาษี (13 หลัก), e-Wallet ID (15 หลัก)
 */
const AID_PROMPTPAY = 'A000000677010111';

const tlv = (id, value) => `${id}${String(value.length).padStart(2, '0')}${value}`;

/** CRC-16/CCITT-FALSE (poly 0x1021, init 0xFFFF) */
export function crc16(str) {
  let crc = 0xffff;
  for (let i = 0; i < str.length; i += 1) {
    crc ^= str.charCodeAt(i) << 8;
    for (let j = 0; j < 8; j += 1) {
      crc = crc & 0x8000 ? (crc << 1) ^ 0x1021 : crc << 1;
      crc &= 0xffff;
    }
  }
  return crc.toString(16).toUpperCase().padStart(4, '0');
}

function targetTag(id) {
  const digits = String(id).replace(/[^0-9]/g, '');
  if (digits.length >= 15) return tlv('03', digits);                  // e-Wallet
  if (digits.length >= 13) return tlv('02', digits);                  // เลขบัตร / Tax ID
  // เบอร์มือถือ: 08xxxxxxxx -> 0066 8xxxxxxxx (ยาว 13 หลัก)
  const phone = `0066${digits.replace(/^0/, '')}`.slice(-13).padStart(13, '0');
  return tlv('01', phone);
}

export function promptpayPayload(id, amount) {
  if (!id) throw new Error('ยังไม่ได้ตั้งค่า PROMPTPAY_ID');
  const hasAmount = amount !== undefined && amount !== null && Number(amount) > 0;

  let data = tlv('00', '01')
    + tlv('01', hasAmount ? '12' : '11')                   // 12 = ใช้ครั้งเดียว (มีจำนวนเงิน)
    + tlv('29', tlv('00', AID_PROMPTPAY) + targetTag(id))
    + tlv('53', '764')                                     // THB
    + (hasAmount ? tlv('54', Number(amount).toFixed(2)) : '')
    + tlv('58', 'TH');
  data += '6304';
  return data + crc16(data);
}

/** ปิดเลขบางส่วนไว้ตอนแสดงผล เช่น 081-xxx-5678 */
export function maskPromptpay(id) {
  const d = String(id || '').replace(/[^0-9]/g, '');
  if (d.length === 10) return `${d.slice(0, 3)}-xxx-${d.slice(-4)}`;
  if (d.length > 4) return `${'x'.repeat(d.length - 4)}${d.slice(-4)}`;
  return d;
}
