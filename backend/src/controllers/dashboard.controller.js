/**
 * Module: Dashboard
 *  แสดงคิวปัจจุบัน / คิวที่รอ / ช่างที่กำลังให้บริการ / สถิติการให้บริการประจำวัน
 */
import { query, shopToday } from '../db.js';
import { asyncHandler } from '../utils/http.js';
import { clientCount } from '../utils/realtime.js';

const today = shopToday;

/** GET /api/dashboard/summary?date= */
export const summary = asyncHandler(async (req, res) => {
  const date = req.query.date || today();

  const [stats, serving, waiting, barbers, hourly, topServices] = await Promise.all([
    // สถิติการให้บริการประจำวัน
    query(
      `SELECT COALESCE(d.total_tickets, 0)    AS total_tickets,
              COALESCE(d.done_count, 0)       AS done_count,
              COALESCE(d.cancelled_count, 0)  AS cancelled_count,
              COALESCE(d.no_show_count, 0)    AS no_show_count,
              COALESCE(d.waiting_count, 0)    AS waiting_count,
              COALESCE(d.active_count, 0)     AS active_count,
              COALESCE(d.unique_customers, 0) AS unique_customers,
              d.avg_wait_min, d.avg_service_min,
              COALESCE(d.revenue, 0)          AS revenue
         FROM (SELECT $1::date AS qd) x
         LEFT JOIN v_daily_stats d ON d.queue_date = x.qd`,
      [date],
    ),
    // คิวที่กำลังให้บริการ
    query(`SELECT * FROM v_queue_board WHERE queue_date=$1 AND status IN ('serving','called')
            ORDER BY status DESC, called_at`, [date]),
    // คิวที่รอ
    query(`SELECT * FROM v_queue_board WHERE queue_date=$1 AND status='waiting'
            ORDER BY position LIMIT 12`, [date]),
    // ช่างที่กำลังให้บริการ
    query(
      `SELECT b.id, b.code, b.nickname, b.status, b.rating, u.full_name, u.avatar_url,
              (SELECT COUNT(*)::int FROM queue_tickets q
                WHERE q.barber_id = b.id AND q.queue_date = $1 AND q.status = 'done') AS served_today,
              (SELECT row_to_json(x) FROM (
                  SELECT ticket_no, customer_name, service_name, started_at, duration_min
                    FROM v_queue_board
                   WHERE barber_id = b.id AND status = 'serving' AND queue_date = $1 LIMIT 1) x) AS current_ticket
         FROM barbers b JOIN users u ON u.id = b.user_id
        ORDER BY CASE b.status WHEN 'serving' THEN 1 WHEN 'available' THEN 2
                               WHEN 'break' THEN 3 ELSE 4 END, b.code`,
      [date],
    ),
    // ปริมาณคิวรายชั่วโมง
    query(
      `SELECT EXTRACT(HOUR FROM issued_at)::int AS hour, COUNT(*)::int AS tickets
         FROM queue_tickets WHERE queue_date = $1
        GROUP BY 1 ORDER BY 1`,
      [date],
    ),
    // บริการยอดนิยมของวัน
    query(
      `SELECT s.name, COUNT(*)::int AS count, COALESCE(SUM(s.price),0) AS revenue
         FROM queue_tickets q JOIN services s ON s.id = q.service_id
        WHERE q.queue_date = $1 AND q.status = 'done'
        GROUP BY s.name ORDER BY count DESC LIMIT 5`,
      [date],
    ),
  ]);

  res.json({
    date,
    stats: stats.rows[0],
    now_serving: serving.rows,
    waiting: waiting.rows,
    barbers: barbers.rows,
    hourly: hourly.rows,
    top_services: topServices.rows,
    realtime_clients: clientCount(),
  });
});

/** GET /api/dashboard/trend?days=7 — แนวโน้มย้อนหลัง */
export const trend = asyncHandler(async (req, res) => {
  const days = Math.min(Math.max(Number(req.query.days) || 7, 1), 90);
  const { rows } = await query(
    `SELECT g.day::date AS queue_date,
            COALESCE(d.total_tickets, 0) AS total_tickets,
            COALESCE(d.done_count, 0)    AS done_count,
            COALESCE(d.revenue, 0)       AS revenue,
            d.avg_wait_min
       FROM generate_series(CURRENT_DATE - ($1::int - 1), CURRENT_DATE, INTERVAL '1 day') g(day)
       LEFT JOIN v_daily_stats d ON d.queue_date = g.day::date
      ORDER BY g.day`,
    [days],
  );
  res.json({ data: rows });
});
