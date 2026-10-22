/**
 * Module: Report Management
 *  รายงานจำนวนลูกค้า / รายงานเวลารอเฉลี่ย / รายงานการให้บริการของช่าง
 */
import { query, shopToday, shopDaysAgo } from '../db.js';
import { asyncHandler } from '../utils/http.js';

/** ช่วงวันที่ default = 30 วันล่าสุด */
function range(req) {
  const to = req.query.to || shopToday();
  const from = req.query.from || shopDaysAgo(29);
  return [from, to];
}

/** GET /api/reports/customers?from=&to=  — รายงานจำนวนลูกค้าประจำวัน */
export const customersReport = asyncHandler(async (req, res) => {
  const [from, to] = range(req);

  const { rows: daily } = await query(
    `SELECT g.day::date AS queue_date,
            COALESCE(d.total_tickets, 0)    AS total_tickets,
            COALESCE(d.unique_customers, 0) AS unique_customers,
            COALESCE(d.done_count, 0)       AS done_count,
            COALESCE(d.cancelled_count, 0)  AS cancelled_count,
            COALESCE(d.no_show_count, 0)    AS no_show_count,
            COALESCE(d.revenue, 0)          AS revenue
       FROM generate_series($1::date, $2::date, INTERVAL '1 day') g(day)
       LEFT JOIN v_daily_stats d ON d.queue_date = g.day::date
      ORDER BY g.day`,
    [from, to],
  );

  const { rows: totals } = await query(
    `SELECT COUNT(*)::int                                            AS total_tickets,
            COUNT(*) FILTER (WHERE status = 'done')::int             AS done_count,
            COUNT(*) FILTER (WHERE status = 'cancelled')::int        AS cancelled_count,
            COUNT(*) FILTER (WHERE status = 'no_show')::int          AS no_show_count,
            COUNT(DISTINCT customer_id)::int                         AS unique_customers,
            COALESCE(SUM(s.price) FILTER (WHERE q.status='done'), 0) AS revenue
       FROM queue_tickets q JOIN services s ON s.id = q.service_id
      WHERE q.queue_date BETWEEN $1 AND $2`,
    [from, to],
  );

  // ลูกค้าที่มาใช้บริการบ่อยที่สุด
  const { rows: topCustomers } = await query(
    `SELECT u.id, u.full_name, u.phone, COUNT(*)::int AS visits,
            COALESCE(SUM(s.price), 0) AS spent, MAX(q.queue_date) AS last_visit
       FROM queue_tickets q
       JOIN users u    ON u.id = q.customer_id
       JOIN services s ON s.id = q.service_id
      WHERE q.queue_date BETWEEN $1 AND $2 AND q.status = 'done'
      GROUP BY u.id, u.full_name, u.phone
      ORDER BY visits DESC, spent DESC LIMIT 10`,
    [from, to],
  );

  // สัดส่วนช่องทางการรับบัตรคิว
  const { rows: bySource } = await query(
    `SELECT source, COUNT(*)::int AS count FROM queue_tickets
      WHERE queue_date BETWEEN $1 AND $2 GROUP BY source ORDER BY count DESC`,
    [from, to],
  );

  res.json({ from, to, daily, totals: totals[0], top_customers: topCustomers, by_source: bySource });
});

/** GET /api/reports/wait-time?from=&to= — รายงานเวลารอเฉลี่ย */
export const waitTimeReport = asyncHandler(async (req, res) => {
  const [from, to] = range(req);

  const { rows: daily } = await query(
    `SELECT queue_date,
            ROUND(AVG(EXTRACT(EPOCH FROM (called_at - issued_at))/60.0)::numeric, 1)  AS avg_wait_min,
            ROUND(MAX(EXTRACT(EPOCH FROM (called_at - issued_at))/60.0)::numeric, 1)  AS max_wait_min,
            ROUND(MIN(EXTRACT(EPOCH FROM (called_at - issued_at))/60.0)::numeric, 1)  AS min_wait_min,
            ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))/60.0)::numeric, 1) AS avg_service_min,
            COUNT(*)::int AS samples
       FROM queue_tickets
      WHERE queue_date BETWEEN $1 AND $2 AND called_at IS NOT NULL
      GROUP BY queue_date ORDER BY queue_date`,
    [from, to],
  );

  // เวลารอเฉลี่ยแยกตามช่วงเวลาของวัน -> ใช้วางแผนกำลังคน
  const { rows: byHour } = await query(
    `SELECT EXTRACT(HOUR FROM issued_at)::int AS hour,
            COUNT(*)::int AS tickets,
            ROUND(AVG(EXTRACT(EPOCH FROM (called_at - issued_at))/60.0)::numeric, 1) AS avg_wait_min
       FROM queue_tickets
      WHERE queue_date BETWEEN $1 AND $2 AND called_at IS NOT NULL
      GROUP BY 1 ORDER BY 1`,
    [from, to],
  );

  const { rows: byService } = await query(
    `SELECT s.name AS service_name, COUNT(*)::int AS tickets,
            ROUND(AVG(EXTRACT(EPOCH FROM (q.called_at - q.issued_at))/60.0)::numeric, 1)   AS avg_wait_min,
            ROUND(AVG(EXTRACT(EPOCH FROM (q.finished_at - q.started_at))/60.0)::numeric, 1) AS avg_service_min,
            s.duration_min AS planned_min
       FROM queue_tickets q JOIN services s ON s.id = q.service_id
      WHERE q.queue_date BETWEEN $1 AND $2 AND q.called_at IS NOT NULL
      GROUP BY s.name, s.duration_min ORDER BY tickets DESC`,
    [from, to],
  );

  const { rows: overall } = await query(
    `SELECT ROUND(AVG(EXTRACT(EPOCH FROM (called_at - issued_at))/60.0)::numeric, 1)    AS avg_wait_min,
            ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - started_at))/60.0)::numeric, 1) AS avg_service_min,
            COUNT(*)::int AS samples
       FROM queue_tickets
      WHERE queue_date BETWEEN $1 AND $2 AND called_at IS NOT NULL`,
    [from, to],
  );

  res.json({ from, to, daily, by_hour: byHour, by_service: byService, overall: overall[0] });
});

/** GET /api/reports/barbers?from=&to= — รายงานการให้บริการของช่าง */
export const barbersReport = asyncHandler(async (req, res) => {
  const [from, to] = range(req);

  const { rows: summary } = await query(
    `SELECT b.id AS barber_id, b.code, b.nickname, b.rating, u.full_name,
            COUNT(q.id) FILTER (WHERE q.status = 'done')::int      AS served_count,
            COUNT(q.id) FILTER (WHERE q.status = 'cancelled')::int AS cancelled_count,
            COUNT(q.id) FILTER (WHERE q.status = 'no_show')::int   AS no_show_count,
            COALESCE(SUM(s.price) FILTER (WHERE q.status = 'done'), 0) AS revenue,
            ROUND(AVG(EXTRACT(EPOCH FROM (q.finished_at - q.started_at))/60.0)::numeric, 1) AS avg_service_min,
            COALESCE(SUM(s.duration_min) FILTER (WHERE q.status = 'done'), 0)::int AS planned_minutes
       FROM barbers b
       JOIN users u ON u.id = b.user_id
       LEFT JOIN queue_tickets q ON q.barber_id = b.id AND q.queue_date BETWEEN $1 AND $2
       LEFT JOIN services s ON s.id = q.service_id
      GROUP BY b.id, b.code, b.nickname, b.rating, u.full_name
      ORDER BY served_count DESC`,
    [from, to],
  );

  // ผลงานรายวันของช่างแต่ละคน (สำหรับกราฟเปรียบเทียบ)
  const { rows: daily } = await query(
    `SELECT q.queue_date, b.code, u.full_name,
            COUNT(*) FILTER (WHERE q.status = 'done')::int AS served_count
       FROM queue_tickets q
       JOIN barbers b ON b.id = q.barber_id
       JOIN users u   ON u.id = b.user_id
      WHERE q.queue_date BETWEEN $1 AND $2
      GROUP BY q.queue_date, b.code, u.full_name
      ORDER BY q.queue_date`,
    [from, to],
  );

  // บริการที่ช่างแต่ละคนทำบ่อยที่สุด
  const { rows: byService } = await query(
    `SELECT b.code, u.full_name, s.name AS service_name, COUNT(*)::int AS count
       FROM queue_tickets q
       JOIN barbers b  ON b.id = q.barber_id
       JOIN users u    ON u.id = b.user_id
       JOIN services s ON s.id = q.service_id
      WHERE q.queue_date BETWEEN $1 AND $2 AND q.status = 'done'
      GROUP BY b.code, u.full_name, s.name
      ORDER BY b.code, count DESC`,
    [from, to],
  );

  res.json({ from, to, summary, daily, by_service: byService });
});

/** GET /api/reports/export?type=customers|wait-time|barbers&from=&to=  — ดาวน์โหลด CSV */
export const exportCsv = asyncHandler(async (req, res) => {
  const [from, to] = range(req);
  const type = req.query.type || 'customers';

  const QUERIES = {
    customers: {
      sql: `SELECT queue_date AS "วันที่", total_tickets AS "จำนวนคิว",
                   unique_customers AS "ลูกค้า(คน)", done_count AS "เสร็จสิ้น",
                   cancelled_count AS "ยกเลิก", revenue AS "รายได้"
              FROM v_daily_stats WHERE queue_date BETWEEN $1 AND $2 ORDER BY queue_date`,
      file: 'customers-report',
    },
    'wait-time': {
      sql: `SELECT queue_date AS "วันที่", avg_wait_min AS "เวลารอเฉลี่ย(นาที)",
                   avg_service_min AS "เวลาให้บริการเฉลี่ย(นาที)", total_tickets AS "จำนวนคิว"
              FROM v_daily_stats WHERE queue_date BETWEEN $1 AND $2 ORDER BY queue_date`,
      file: 'wait-time-report',
    },
    barbers: {
      sql: `SELECT b.code AS "รหัสช่าง", u.full_name AS "ชื่อช่าง",
                   COUNT(q.id) FILTER (WHERE q.status='done')::int AS "ให้บริการ(คิว)",
                   COALESCE(SUM(s.price) FILTER (WHERE q.status='done'),0) AS "รายได้",
                   ROUND(AVG(EXTRACT(EPOCH FROM (q.finished_at-q.started_at))/60.0)::numeric,1) AS "เวลาเฉลี่ย(นาที)"
              FROM barbers b JOIN users u ON u.id=b.user_id
              LEFT JOIN queue_tickets q ON q.barber_id=b.id AND q.queue_date BETWEEN $1 AND $2
              LEFT JOIN services s ON s.id=q.service_id
             GROUP BY b.code, u.full_name ORDER BY b.code`,
      file: 'barbers-report',
    },
  };

  const spec = QUERIES[type] || QUERIES.customers;
  const { rows, fields } = await query(spec.sql, [from, to]);

  const escape = (v) => {
    if (v === null || v === undefined) return '';
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = fields.map((f) => f.name);
  const csv = [header.join(','), ...rows.map((r) => header.map((h) => escape(r[h])).join(','))].join('\r\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${spec.file}-${from}-to-${to}.csv"`);
  res.send('﻿' + csv); // BOM เพื่อให้ Excel อ่านภาษาไทยถูกต้อง
});
