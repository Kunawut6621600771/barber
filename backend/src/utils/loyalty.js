/**
 * กติกาแต้มสะสม (pure function — ไม่แตะฐานข้อมูล ทดสอบด้วย unit test ได้)
 */
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** แต้มที่ได้จากยอดชำระ (ปัดลง) */
export function pointsEarnedFor(total, pointsPerBaht) {
  if (!(pointsPerBaht > 0) || !(total > 0)) return 0;
  // บวก epsilon กันทศนิยมลอยตัว เช่น 100 * 0.29 = 28.999999999999996 (ต้องได้ 29 ไม่ใช่ 28)
  return Math.floor(total * pointsPerBaht + 1e-9);
}

/** ส่วนลดของบิล (บาท) จากชนิดส่วนลด — ไม่เกินยอดรวม */
export function discountAmount(subtotal, type, value) {
  const v = Math.max(Number(value) || 0, 0);
  if (type === 'percent') return round2(subtotal * Math.min(v, 100) / 100);
  return Math.min(v, subtotal);
}

/** แต้มสูงสุดที่ใช้ได้กับยอดคงเหลือหลังหักส่วนลด */
export function maxRedeemablePoints(remaining, pointValueBaht) {
  if (!(pointValueBaht > 0) || !(remaining > 0)) return 0;
  return Math.floor(remaining / pointValueBaht + 1e-9);
}

/**
 * แต้มที่ต้องหักคืนเมื่อคืนเงิน (ตามสัดส่วนยอดคืน ไม่หักซ้ำส่วนที่หักไปแล้ว)
 * @param {{earned:number,total:number,refundedBefore:number,refundedAfter:number,isFull:boolean}} p
 */
export function pointsToReverse({ earned, total, refundedBefore, refundedAfter, isFull }) {
  if (!(earned > 0) || !(total > 0)) return 0;
  const should = isFull ? earned : Math.floor(earned * refundedAfter / total + 1e-9);
  const already = Math.floor(earned * refundedBefore / total + 1e-9);
  return Math.max(should - already, 0);
}
