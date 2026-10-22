/**
 * Real-time ด้วย Server-Sent Events (SSE)
 * ใช้ติดตามสถานะคิวแบบ Real-time ตาม Objective ของระบบ
 *  - จอหน้าร้าน / Dashboard  : subscribe แบบ public (userId = null)
 *  - ลูกค้าที่ล็อกอิน        : ได้รับ event เฉพาะตัวด้วย
 */
const clients = new Set(); // { res, userId }

export function addClient(res, userId = null) {
  const client = { res, userId };
  clients.add(client);
  return () => clients.delete(client);
}

/**
 * @param {string} event  ชื่อ event เช่น 'queue:update', 'notification'
 * @param {object} data
 * @param {number|null} targetUserId  ถ้าระบุ จะส่งเฉพาะ client ของ user คนนั้น
 */
export function broadcast(event, data, targetUserId = null) {
  const frame = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of clients) {
    if (targetUserId !== null && client.userId !== targetUserId) continue;
    try {
      client.res.write(frame);
    } catch {
      clients.delete(client);
    }
  }
}

export const clientCount = () => clients.size;
