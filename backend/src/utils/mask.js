/** ปิดชื่อบางส่วนก่อนแสดงต่อสาธารณะ เช่น "สมชาย ใจดี" -> "สมชาย ใ." */
export function maskName(name) {
  const parts = String(name || '').trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return name ?? null; // คิว walk-in ไม่มีชื่อ คงค่า null เดิมไว้
  return parts.length > 1 ? `${parts[0]} ${[...parts[1]][0]}.` : parts[0];
}
