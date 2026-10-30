/**
 * Module: Queue Management
 *  รับบัตรคิว / เรียกคิว / ข้ามคิว / ยกเลิกคิว / เรียกคิวซ้ำ
 *  แสดงคิวปัจจุบัน / แสดงจำนวนคิวที่รอ / จัดลำดับคิวอัตโนมัติ
 */
import QRCode from 'qrcode';
import { config } from '../config.js';
import { query, withTransaction, shopToday } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { broadcast } from '../utils/realtime.js';
import { notifyTicket, notifyNearTurn } from '../utils/notify.js';

const today = shopToday; // "วันนี้" ตามเขตเวลาของร้าน ตรงกับ CURRENT_DATE ของฐานข้อมูล

const loadTicket = async (client, id) => {
  const { rows } = await client.query('SELECT * FROM v_queue_board WHERE id = $1', [id]);
  return rows[0] || null;
};

/** จัดลำดับคิวใหม่ + แจ้งเตือนใกล้ถึงคิว + push real-time */
async function refreshQueue(client, queueDate) {
  await client.query('SELECT reorder_queue($1)', [queueDate]);
  await notifyNearTurn(client, queueDate);

  const { rows } = await client.query(
    `SELECT * FROM v_queue_board
      WHERE queue_date = $1 AND status IN ('waiting','called','serving')
      ORDER BY status, position NULLS FIRST, seq`,
    [queueDate],
  );
  broadcast('queue:update', { queue_date: queueDate, tickets: rows });
  return rows;
}

/** บันทึกประวัติการเปลี่ยนสถานะคิว */
const logEvent = (client, ticketId, eventType, from, to, actorId, note = null) =>
  client.query(
    `INSERT INTO queue_events (ticket_id, event_type, from_status, to_status, actor_id, note)
     VALUES ($1,$2,$3,$4,$5,$6)`,
    [ticketId, eventType, from, to, actorId ?? null, note],
  );

/* ======================= รับบัตรคิว ======================= */

/** POST /api/queue — รับบัตรคิว (ลูกค้าเอง หรือพนักงานออกให้ walk-in) */
export const takeTicket = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    service_id: { type: 'int', required: true, label: 'บริการ' },
    barber_id: { type: 'int', label: 'ช่างตัดผม' },
    customer_id: { type: 'int', label: 'ลูกค้า' },
    guest_name: { type: 'string', max: 150, label: 'ชื่อลูกค้า' },
    guest_phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    source: { type: 'enum', enum: ['walk_in', 'qr_code', 'online'], default: 'walk_in', label: 'ช่องทาง' },
    priority: { type: 'int', min: 0, max: 10, default: 0, label: 'ลำดับความสำคัญ' },
  });

  const isStaff = ['admin', 'staff', 'barber'].includes(req.user.role);
  // ลูกค้าออกบัตรได้เฉพาะให้ตัวเอง ส่วนพนักงานออกให้ลูกค้าคนอื่น/walk-in ได้
  const customerId = isStaff ? (data.customer_id ?? null) : req.user.id;
  const guestName = isStaff ? (data.guest_name ?? null) : null;

  if (!customerId && !guestName) throw ApiError.badRequest('กรุณาระบุลูกค้า หรือชื่อลูกค้า walk-in');
  if (!isStaff && data.priority) throw ApiError.forbidden('ไม่สามารถกำหนดลำดับความสำคัญเองได้');

  // ลูกค้าต้องชำระเงินผ่าน QR ก่อน (POST /api/payments) ระบบจะออกบัตรคิวให้เมื่อตรวจสลิปผ่าน
  if (!isStaff && config.payment.required) {
    throw new ApiError(402, 'กรุณาชำระเงินผ่าน QR PromptPay ก่อนรับบัตรคิว');
  }

  const result = await withTransaction((client) => issueTicket(client, {
    customerId,
    guestName,
    guestPhone: data.guest_phone ?? null,
    serviceId: data.service_id,
    barberId: data.barber_id ?? null,
    source: data.source,
    priority: data.priority ?? 0,
    actorId: req.user.id,
  }));

  res.status(201).json(await ticketResponse(result));
});

/** แนบ QR ให้ลูกค้าใช้ติดตามคิวของตนเอง */
export async function ticketResponse({ ticket, qrToken }) {
  const trackUrl = `${config.publicUrl}/track/${qrToken}`;
  return {
    ticket,
    track_url: trackUrl,
    qr_code: await QRCode.toDataURL(trackUrl, { width: 320, margin: 1 }),
  };
}

/**
 * ออกบัตรคิว (ใช้ร่วมกันระหว่าง "พนักงานออกบัตร" และ "ลูกค้าชำระเงินสำเร็จ")
 * ต้องเรียกภายใน transaction
 */
export async function issueTicket(client, {
  customerId = null, guestName = null, guestPhone = null,
  serviceId, barberId = null, source = 'walk_in', priority = 0, actorId = null,
}) {
  const queueDate = today();

  const { rows: svc } = await client.query(
    'SELECT id, name, duration_min, price FROM services WHERE id = $1 AND is_active = TRUE',
    [serviceId],
  );
  if (!svc[0]) throw ApiError.badRequest('ไม่พบบริการนี้ หรือบริการถูกปิดการใช้งาน');

  if (barberId) {
    const { rows: b } = await client.query(`SELECT id FROM barbers WHERE id = $1 AND status <> 'off'`, [barberId]);
    if (!b[0]) throw ApiError.badRequest('ช่างคนนี้ไม่พร้อมให้บริการในขณะนี้');
  }

  // ระบบออกหมายเลขคิวอัตโนมัติ (ล็อกกันเลขชนกันอยู่ในฟังก์ชัน)
  const { rows: no } = await client.query('SELECT * FROM next_ticket_no($1)', [queueDate]);
  const { out_seq: seq, out_ticket_no: ticketNo } = no[0];

  const { rows: waitingRows } = await client.query(
    `SELECT COUNT(*)::int AS n FROM queue_tickets
      WHERE queue_date = $1 AND status IN ('waiting','called')`,
    [queueDate],
  );
  const { rows: est } = await client.query('SELECT estimate_wait_minutes($1, $2) AS mins', [queueDate, waitingRows[0].n + 1]);

  const { rows: inserted } = await client.query(
    `INSERT INTO queue_tickets
       (ticket_no, queue_date, seq, customer_id, guest_name, guest_phone,
        service_id, barber_id, source, priority, estimated_wait_min)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     RETURNING id, qr_token`,
    [ticketNo, queueDate, seq, customerId, guestName, guestPhone,
      serviceId, barberId, source, priority, est[0].mins],
  );

  await logEvent(client, inserted[0].id, 'issue', null, 'waiting', actorId);
  await refreshQueue(client, queueDate);

  const ticket = await loadTicket(client, inserted[0].id);
  return { ticket, qrToken: inserted[0].qr_token };
}

/* ======================= แสดงคิว ======================= */

/** GET /api/queue?date=&status= — กระดานคิวทั้งหมดของวัน */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/** วันที่จาก query string ที่เชื่อถือได้ (ค่าแปลก ๆ ควรตอบ 400 ไม่ใช่ 500 จาก Postgres) */
function queryDate(value) {
  if (!value) return today();
  if (!DATE_RE.test(String(value))) throw ApiError.badRequest('รูปแบบวันที่ไม่ถูกต้อง (YYYY-MM-DD)');
  return String(value);
}

export const listQueue = asyncHandler(async (req, res) => {
  const queueDate = queryDate(req.query.date);
  const params = [queueDate];
  let statusSql = '';

  if (req.query.status) {
    const statuses = String(req.query.status).split(',').map((s) => s.trim());
    params.push(statuses);
    statusSql = `AND status = ANY($${params.length}::queue_status[])`;
  }

  const { rows } = await query(
    `SELECT * FROM v_queue_board
      WHERE queue_date = $1 ${statusSql}
      ORDER BY CASE status
                 WHEN 'serving' THEN 1 WHEN 'called' THEN 2 WHEN 'waiting' THEN 3 ELSE 4 END,
               position NULLS LAST, seq`,
    params,
  );
  res.json({ data: rows, queue_date: queueDate });
});

/** GET /api/queue/current — คิวปัจจุบัน + จำนวนคิวที่รอ (ใช้กับจอหน้าร้าน, public) */
export const currentQueue = asyncHandler(async (_req, res) => {
  const queueDate = today();

  const [serving, called, waiting, counts] = await Promise.all([
    query(`SELECT * FROM v_queue_board WHERE queue_date=$1 AND status='serving' ORDER BY started_at`, [queueDate]),
    query(`SELECT * FROM v_queue_board WHERE queue_date=$1 AND status='called'  ORDER BY called_at`, [queueDate]),
    query(`SELECT * FROM v_queue_board WHERE queue_date=$1 AND status='waiting' ORDER BY position LIMIT 10`, [queueDate]),
    query(
      `SELECT COUNT(*) FILTER (WHERE status='waiting')::int AS waiting_count,
              COUNT(*) FILTER (WHERE status='serving')::int AS serving_count,
              COUNT(*) FILTER (WHERE status='done')::int    AS done_count,
              COUNT(*)::int                                 AS total_count
         FROM queue_tickets WHERE queue_date = $1`,
      [queueDate],
    ),
  ]);

  res.json({
    queue_date: queueDate,
    now_serving: serving.rows,
    called: called.rows,
    waiting: waiting.rows,
    ...counts.rows[0],
  });
});

/** GET /api/queue/my — คิวของฉัน + เหลืออีกกี่คิว */
export const myQueue = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT * FROM v_queue_board
      WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called','serving')
      ORDER BY seq LIMIT 1`,
    [req.user.id, today()],
  );
  const ticket = rows[0] || null;

  const { rows: history } = await query(
    `SELECT * FROM v_queue_board WHERE customer_id = $1
      ORDER BY queue_date DESC, seq DESC LIMIT 10`,
    [req.user.id],
  );

  if (!ticket) return res.json({ ticket: null, remaining: null, history });

  const { rows: ahead } = await query(
    `SELECT COUNT(*)::int AS n FROM queue_tickets
      WHERE queue_date = $1 AND status = 'waiting' AND position < $2`,
    [ticket.queue_date, ticket.position ?? 0],
  );
  const { rows: est } = await query('SELECT estimate_wait_minutes($1,$2) AS mins', [ticket.queue_date, ticket.position ?? 1]);

  res.json({ ticket, remaining: ahead[0].n, estimated_wait_min: est[0].mins, history });
});

/** GET /api/queue/track/:token — ติดตามคิวผ่าน QR (ไม่ต้องล็อกอิน) */
export const trackTicket = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT v.* FROM v_queue_board v
       JOIN queue_tickets q ON q.id = v.id
      WHERE q.qr_token::text = $1`,
    [req.params.token],
  );
  const ticket = rows[0];
  if (!ticket) throw ApiError.notFound('ไม่พบบัตรคิวนี้');

  const { rows: ahead } = await query(
    `SELECT COUNT(*)::int AS n FROM queue_tickets
      WHERE queue_date = $1 AND status = 'waiting' AND position < $2`,
    [ticket.queue_date, ticket.position ?? 0],
  );
  const { rows: est } = await query('SELECT estimate_wait_minutes($1,$2) AS mins', [ticket.queue_date, ticket.position ?? 1]);

  res.json({ ticket, remaining: ahead[0].n, estimated_wait_min: est[0].mins });
});

/** GET /api/queue/shop-qr — QR หน้าร้านสำหรับสแกนรับบัตรคิว (public) */
export const shopQr = asyncHandler(async (_req, res) => {
  const url = `${config.publicUrl}/app/take-queue?src=qr`;
  res.json({ url, qr_code: await QRCode.toDataURL(url, { width: 400, margin: 1 }) });
});

/* ======================= การจัดการคิว ======================= */

/** POST /api/queue/call — เรียกคิวถัดไป (auto pick) */
export const callNext = asyncHandler(async (req, res) => {
  const barberId = req.body?.barber_id ?? req.user.barber_id ?? null;
  const queueDate = today();

  const ticket = await withTransaction(async (client) => {
    // เลือกคิวแรกที่รออยู่ โดยให้คิวที่จองช่างคนนี้ไว้มาก่อน
    const { rows } = await client.query(
      `SELECT id, status, ticket_no, customer_id FROM queue_tickets
        WHERE queue_date = $1 AND status = 'waiting'
          AND (barber_id IS NULL OR barber_id = $2::bigint OR $2::bigint IS NULL)
        ORDER BY (barber_id = $2::bigint) DESC NULLS LAST, position, seq
        FOR UPDATE SKIP LOCKED
        LIMIT 1`,
      [queueDate, barberId],
    );
    if (!rows[0]) throw ApiError.notFound('ไม่มีคิวที่รออยู่');

    return callTicketInTx(client, rows[0], barberId, req.user.id);
  });

  res.json({ ticket, message: `เรียกคิว ${ticket.ticket_no} แล้ว` });
});

/** POST /api/queue/:id/call — เรียกคิวที่ระบุ */
export const callTicket = asyncHandler(async (req, res) => {
  const barberId = req.body?.barber_id ?? req.user.barber_id ?? null;

  const ticket = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, ticket_no, customer_id FROM queue_tickets WHERE id = $1 FOR UPDATE`,
      [req.params.id],
    );
    if (!rows[0]) throw ApiError.notFound('ไม่พบคิวนี้');
    if (rows[0].status !== 'waiting') throw ApiError.conflict('เรียกได้เฉพาะคิวที่อยู่ในสถานะรอเท่านั้น');

    return callTicketInTx(client, rows[0], barberId, req.user.id);
  });

  res.json({ ticket, message: `เรียกคิว ${ticket.ticket_no} แล้ว` });
});

async function callTicketInTx(client, row, barberId, actorId) {
  await client.query(
    `UPDATE queue_tickets
        SET status = 'called', called_at = NOW(), position = NULL,
            barber_id = COALESCE($2, barber_id)
      WHERE id = $1`,
    [row.id, barberId],
  );
  await logEvent(client, row.id, 'call', row.status, 'called', actorId);

  const ticket = await loadTicket(client, row.id);
  await notifyTicket(client, { type: 'your_turn', ticket });
  await refreshQueue(client, ticket.queue_date);
  broadcast('queue:called', ticket);
  return ticket;
}

/** POST /api/queue/:id/recall — เรียกคิวซ้ำ */
export const recallTicket = asyncHandler(async (req, res) => {
  const ticket = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT id, status FROM queue_tickets WHERE id = $1 FOR UPDATE', [req.params.id]);
    if (!rows[0]) throw ApiError.notFound('ไม่พบคิวนี้');
    if (rows[0].status !== 'called') throw ApiError.conflict('เรียกซ้ำได้เฉพาะคิวที่เรียกไปแล้วเท่านั้น');

    await client.query(
      `UPDATE queue_tickets SET recall_count = recall_count + 1, called_at = NOW() WHERE id = $1`,
      [req.params.id],
    );
    await logEvent(client, rows[0].id, 'recall', 'called', 'called', req.user.id);

    const t = await loadTicket(client, rows[0].id);
    await notifyTicket(client, { type: 'called_again', ticket: t });
    broadcast('queue:called', t);
    return t;
  });

  res.json({ ticket, message: `เรียกคิว ${ticket.ticket_no} ซ้ำ (ครั้งที่ ${ticket.recall_count})` });
});

/** POST /api/queue/:id/skip — ข้ามคิว (เลื่อนไปท้ายแถว, ข้ามครบ 2 ครั้ง = ไม่มาตามคิว) */
export const skipTicket = asyncHandler(async (req, res) => {
  const MAX_SKIP = 2;

  const result = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT id, status, skip_count FROM queue_tickets WHERE id = $1 FOR UPDATE`, [req.params.id],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('ไม่พบคิวนี้');
    if (!['waiting', 'called'].includes(row.status)) throw ApiError.conflict('ข้ามได้เฉพาะคิวที่รอ หรือเรียกแล้วเท่านั้น');

    const nextSkip = row.skip_count + 1;
    const nextStatus = nextSkip >= MAX_SKIP ? 'no_show' : 'waiting';

    await client.query(
      `UPDATE queue_tickets
          SET skip_count = $2, status = $3::queue_status, called_at = NULL, position = NULL
        WHERE id = $1`,
      [row.id, nextSkip, nextStatus],
    );
    await logEvent(client, row.id, 'skip', row.status, nextStatus, req.user.id, `ข้ามคิวครั้งที่ ${nextSkip}`);

    const ticket = await loadTicket(client, row.id);
    await notifyTicket(client, { type: 'skipped', ticket });
    await refreshQueue(client, ticket.queue_date);
    broadcast('queue:skipped', ticket);

    return {
      ticket: await loadTicket(client, row.id),
      message: nextStatus === 'no_show'
        ? `คิว ${ticket.ticket_no} ถูกข้ามครบ ${MAX_SKIP} ครั้ง ระบบบันทึกเป็น "ไม่มาตามคิว"`
        : `ข้ามคิว ${ticket.ticket_no} แล้ว ระบบเลื่อนไปท้ายแถว`,
    };
  });

  res.json(result);
});

/** POST /api/queue/:id/cancel — ยกเลิกคิว (ลูกค้ายกเลิกของตัวเองได้) */
export const cancelTicket = asyncHandler(async (req, res) => {
  const reason = (req.body?.reason || '').trim() || null;

  const ticket = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, status, customer_id FROM queue_tickets WHERE id = $1 FOR UPDATE', [req.params.id],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('ไม่พบคิวนี้');

    const isStaff = ['admin', 'staff', 'barber'].includes(req.user.role);
    if (!isStaff && row.customer_id !== req.user.id) throw ApiError.forbidden('ยกเลิกได้เฉพาะคิวของตนเอง');
    if (!['waiting', 'called'].includes(row.status)) throw ApiError.conflict('ไม่สามารถยกเลิกคิวที่กำลังให้บริการหรือเสร็จสิ้นแล้ว');

    await client.query(
      `UPDATE queue_tickets
          SET status = 'cancelled', cancelled_at = NOW(), position = NULL, cancel_reason = $2
        WHERE id = $1`,
      [row.id, reason],
    );
    await logEvent(client, row.id, 'cancel', row.status, 'cancelled', req.user.id, reason);

    const t = await loadTicket(client, row.id);
    await notifyTicket(client, { type: 'cancelled', ticket: t, reason });
    await refreshQueue(client, t.queue_date);
    broadcast('queue:cancelled', t);
    return t;
  });

  res.json({ ticket, message: `ยกเลิกคิว ${ticket.ticket_no} เรียบร้อยแล้ว` });
});

/** POST /api/queue/:id/start — เริ่มให้บริการ */
export const startService = asyncHandler(async (req, res) => {
  const ticket = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, status, barber_id FROM queue_tickets WHERE id = $1 FOR UPDATE', [req.params.id],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('ไม่พบคิวนี้');
    if (!['called', 'waiting'].includes(row.status)) throw ApiError.conflict('คิวนี้ไม่อยู่ในสถานะที่เริ่มให้บริการได้');

    const barberId = req.body?.barber_id ?? row.barber_id ?? req.user.barber_id ?? null;
    if (!barberId) throw ApiError.badRequest('กรุณาระบุช่างที่ให้บริการ');

    await client.query(
      `UPDATE queue_tickets
          SET status = 'serving', started_at = NOW(), position = NULL,
              called_at = COALESCE(called_at, NOW()), barber_id = $2
        WHERE id = $1`,
      [row.id, barberId],
    );
    await client.query(`UPDATE barbers SET status = 'serving' WHERE id = $1`, [barberId]);
    await logEvent(client, row.id, 'start', row.status, 'serving', req.user.id);

    const t = await loadTicket(client, row.id);
    await refreshQueue(client, t.queue_date);
    return t;
  });

  res.json({ ticket, message: `เริ่มให้บริการคิว ${ticket.ticket_no}` });
});

/** POST /api/queue/:id/done — ให้บริการเสร็จสิ้น */
export const finishService = asyncHandler(async (req, res) => {
  const ticket = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, status, barber_id FROM queue_tickets WHERE id = $1 FOR UPDATE', [req.params.id],
    );
    const row = rows[0];
    if (!row) throw ApiError.notFound('ไม่พบคิวนี้');
    if (row.status !== 'serving') throw ApiError.conflict('ปิดคิวได้เฉพาะคิวที่กำลังให้บริการเท่านั้น');

    await client.query(`UPDATE queue_tickets SET status = 'done', finished_at = NOW() WHERE id = $1`, [row.id]);
    await logEvent(client, row.id, 'done', 'serving', 'done', req.user.id);

    if (row.barber_id) {
      // ถ้าช่างไม่มีคิวอื่นค้างอยู่ ให้กลับเป็นสถานะว่าง
      const { rows: busy } = await client.query(
        `SELECT 1 FROM queue_tickets WHERE barber_id = $1 AND status = 'serving' LIMIT 1`, [row.barber_id],
      );
      if (!busy.length) await client.query(`UPDATE barbers SET status = 'available' WHERE id = $1`, [row.barber_id]);
    }

    const t = await loadTicket(client, row.id);
    await notifyTicket(client, { type: 'done', ticket: t });
    await refreshQueue(client, t.queue_date);
    return t;
  });

  res.json({ ticket, message: `ปิดคิว ${ticket.ticket_no} เรียบร้อยแล้ว` });
});

/** POST /api/queue/reorder — จัดลำดับคิวอัตโนมัติ */
export const reorderQueue = asyncHandler(async (req, res) => {
  const queueDate = queryDate(req.body?.date);
  const tickets = await withTransaction((client) => refreshQueue(client, queueDate));
  res.json({ message: 'จัดลำดับคิวใหม่เรียบร้อยแล้ว', data: tickets });
});

/** GET /api/queue/:id/events — ประวัติการเปลี่ยนสถานะของคิว */
export const ticketEvents = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT e.*, u.full_name AS actor_name
       FROM queue_events e LEFT JOIN users u ON u.id = e.actor_id
      WHERE e.ticket_id = $1 ORDER BY e.created_at`,
    [req.params.id],
  );
  res.json({ data: rows });
});
