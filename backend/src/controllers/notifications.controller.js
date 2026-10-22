/**
 * Module: Notification
 *  แจ้งเตือนเมื่อใกล้ถึงคิว / ถึงคิว / ยกเลิกคิว
 *  (การสร้างแจ้งเตือนอยู่ใน utils/notify.js ซึ่งถูกเรียกจาก queue.controller)
 */
import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { addClient } from '../utils/realtime.js';

/** GET /api/notifications?unread_only= */
export const listNotifications = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 30, 100);
  const params = [req.user.id, limit];
  const unreadSql = req.query.unread_only === 'true' ? 'AND n.is_read = FALSE' : '';

  const { rows } = await query(
    `SELECT n.*, q.ticket_no, q.status AS ticket_status
       FROM notifications n LEFT JOIN queue_tickets q ON q.id = n.ticket_id
      WHERE n.user_id = $1 ${unreadSql}
      ORDER BY n.created_at DESC LIMIT $2`,
    params,
  );
  const { rows: count } = await query(
    'SELECT COUNT(*)::int AS unread FROM notifications WHERE user_id = $1 AND is_read = FALSE',
    [req.user.id],
  );
  res.json({ data: rows, unread: count[0].unread });
});

/** PATCH /api/notifications/:id/read */
export const markRead = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW()
      WHERE id = $1 AND user_id = $2 RETURNING *`,
    [req.params.id, req.user.id],
  );
  if (!rows[0]) throw ApiError.notFound('ไม่พบการแจ้งเตือนนี้');
  res.json({ notification: rows[0] });
});

/** PATCH /api/notifications/read-all */
export const markAllRead = asyncHandler(async (req, res) => {
  const { rowCount } = await query(
    `UPDATE notifications SET is_read = TRUE, read_at = NOW()
      WHERE user_id = $1 AND is_read = FALSE`,
    [req.user.id],
  );
  res.json({ message: `ทำเครื่องหมายอ่านแล้ว ${rowCount} รายการ` });
});

/** DELETE /api/notifications/:id */
export const removeNotification = asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM notifications WHERE id = $1 AND user_id = $2',
    [req.params.id, req.user.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบการแจ้งเตือนนี้');
  res.json({ message: 'ลบการแจ้งเตือนเรียบร้อยแล้ว' });
});

/**
 * GET /api/notifications/stream?token=<jwt>
 * ช่องทาง real-time (SSE). EventSource ส่ง header เองไม่ได้ จึงรับ token ทาง query
 * ไม่ส่ง token มาก็ได้ -> จะได้รับเฉพาะ event สาธารณะ (สถานะคิวหน้าร้าน)
 */
export const stream = (req, res) => {
  let userId = null;
  if (req.query.token) {
    try {
      userId = jwt.verify(req.query.token, config.jwt.secret).sub;
    } catch {
      userId = null;
    }
  }

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: connected\ndata: ${JSON.stringify({ userId })}\n\n`);

  const remove = addClient(res, userId);
  const ping = setInterval(() => res.write(': ping\n\n'), 25_000);

  req.on('close', () => {
    clearInterval(ping);
    remove();
  });
};
