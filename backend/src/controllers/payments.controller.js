/**
 * Module: Payment (QR PromptPay + ตรวจสลิปอัตโนมัติ)
 *
 * ขั้นตอนของลูกค้า
 *   1. POST /api/payments            เลือกบริการ -> ได้ QR PromptPay ตามราคาบริการ
 *   2. ลูกค้าสแกนจ่ายด้วยแอปธนาคาร
 *   3. POST /api/payments/:id/slip   อัปโหลดสลิป -> ตรวจกับ API -> ผ่านแล้วออกบัตรคิวให้ทันที
 *
 * พนักงาน
 *   GET  /api/payments               ดูรายการชำระเงินของวัน
 *   POST /api/payments/:id/approve   ยืนยันเอง (เช่น ระบบตรวจสลิปขัดข้อง / จ่ายเงินสด)
 */
import crypto from 'node:crypto';
import QRCode from 'qrcode';
import { config } from '../config.js';
import { query, withTransaction, onCommit, shopToday } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { broadcast } from '../utils/realtime.js';
import { promptpayPayload, maskPromptpay } from '../utils/promptpay.js';
import { verifySlip, SlipError, slipProviderName, decodeSlipImage } from '../utils/slip.js';
import { lineEnabled, pushMessage } from '../utils/line.js';
import { queueCard, paymentCard } from '../utils/line-flex.js';
import { issueTicket, ticketResponse } from './queue.controller.js';

const MAX_VERIFY_ATTEMPTS = 10;
const isStaffRole = (role) => ['admin', 'staff', 'barber'].includes(role);

const newRefCode = () => {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const bytes = crypto.randomBytes(6);
  return `PAY-${Array.from(bytes, (b) => alphabet[b % alphabet.length]).join('')}`;
};

const PAYMENT_SELECT = `
  SELECT p.*,
         s.name AS service_name, s.duration_min,
         cu.full_name AS customer_name, cu.phone AS customer_phone,
         bu.full_name AS barber_name,
         q.ticket_no, q.status AS ticket_status
    FROM payments p
    JOIN services s     ON s.id = p.service_id
    JOIN users cu       ON cu.id = p.customer_id
    LEFT JOIN barbers b ON b.id = p.barber_id
    LEFT JOIN users bu  ON bu.id = b.user_id
    LEFT JOIN queue_tickets q ON q.id = p.ticket_id`;

/** เก็บรูปสลิปทุกครั้งที่ลูกค้าส่ง — เก็บไม่สำเร็จไม่ทำให้การชำระเงินล้ม */
async function saveSlip(paymentId, image, { ok, reason = null, userId = null }) {
  const img = decodeSlipImage(image);
  if (!img) return;
  await query(
    `INSERT INTO payment_slips (payment_id, mime, image, ok, reason, uploaded_by)
     VALUES ($1, $2, $3, $4, $5, $6)`,
    [paymentId, img.mime, img.buf, ok, reason, userId],
  ).catch((err) => console.error('[payment_slips] save failed:', err.message));
}

async function loadPayment(db, id, lock = false) {
  const { rows } = await db.query(
    lock ? 'SELECT * FROM payments WHERE id = $1 FOR UPDATE' : `${PAYMENT_SELECT} WHERE p.id = $1`,
    [id],
  );
  return rows[0] || null;
}

/** ข้อมูลที่ส่งให้ client (ตัดข้อมูลดิบของสลิปออก) */
function publicPayment(p) {
  const expired = p.status === 'pending' && new Date(p.expires_at) < new Date();
  const { slip_data: _raw, promptpay_id: ppId, ...rest } = p;
  return {
    ...rest,
    status: expired ? 'expired' : p.status,
    promptpay_masked: maskPromptpay(ppId),
    account_name: config.payment.accountName || null,
  };
}

async function withQr(p) {
  const out = publicPayment(p);
  if (['pending', 'expired'].includes(out.status) && Number(p.amount) > 0) {
    const payload = promptpayPayload(p.promptpay_id, p.amount);
    out.qr_payload = payload;
    out.qr_code = await QRCode.toDataURL(payload, { width: 360, margin: 1, errorCorrectionLevel: 'M' });
  }
  return out;
}

function assertOwnerOrStaff(req, payment) {
  if (!payment) throw ApiError.notFound('ไม่พบรายการชำระเงิน');
  if (!isStaffRole(req.user.role) && payment.customer_id !== req.user.id) throw ApiError.forbidden();
}

/* ======================= ลูกค้า ======================= */

/** GET /api/payments/config — ค่าที่หน้าเว็บต้องรู้ก่อนเริ่มจ่าย */
export const paymentConfig = asyncHandler(async (_req, res) => {
  res.json({
    required: config.payment.required,
    promptpay_masked: maskPromptpay(config.payment.promptpayId),
    account_name: config.payment.accountName || null,
    expire_minutes: config.payment.expireMinutes,
    provider: slipProviderName(),
    test_mode: slipProviderName() === 'mock',
  });
});

/** POST /api/payments — สร้างรายการชำระเงิน + QR PromptPay */
export const createPayment = asyncHandler(async (req, res) => {
  if (!config.payment.promptpayId) throw ApiError.badRequest('ร้านยังไม่ได้ตั้งค่าพร้อมเพย์ (PROMPTPAY_ID)');
  if (isStaffRole(req.user.role)) throw ApiError.forbidden('พนักงานออกบัตรคิวให้ลูกค้าได้จากหน้าจัดการคิว');

  const data = validate(req.body, {
    service_id: { type: 'int', required: true, label: 'บริการ' },
    barber_id: { type: 'int', label: 'ช่างตัดผม' },
    source: { type: 'enum', enum: ['qr_code', 'online'], default: 'online', label: 'ช่องทาง' },
  });

  const result = await withTransaction(async (client) => {
    // ล็อกต่อผู้ใช้ กันกดปุ่มซ้ำแล้วได้ QR สองอัน
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [`payment_user_${req.user.id}`]);

    const { rows: active } = await client.query(
      `SELECT ticket_no FROM queue_tickets
        WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called','serving')`,
      [req.user.id, shopToday()],
    );
    if (active[0]) throw ApiError.conflict(`คุณมีคิว ${active[0].ticket_no} ที่ยังไม่เสร็จสิ้นอยู่แล้ว`);

    const { rows: svc } = await client.query(
      'SELECT id, price FROM services WHERE id = $1 AND is_active = TRUE', [data.service_id],
    );
    if (!svc[0]) throw ApiError.badRequest('ไม่พบบริการนี้ หรือบริการถูกปิดการใช้งาน');

    if (data.barber_id) {
      const { rows: b } = await client.query(`SELECT id FROM barbers WHERE id = $1 AND status <> 'off'`, [data.barber_id]);
      if (!b[0]) throw ApiError.badRequest('ช่างคนนี้ไม่พร้อมให้บริการในขณะนี้');
    }

    // รายการที่ค้างจ่ายอันเดิมถือว่ายกเลิก (ลูกค้าเปลี่ยนใจเลือกบริการใหม่)
    await client.query(
      `UPDATE payments SET status = 'cancelled'
        WHERE customer_id = $1 AND status = 'pending'`,
      [req.user.id],
    );

    // บริการฟรี -> ออกบัตรคิวได้เลย
    if (Number(svc[0].price) <= 0) {
      const issued = await issueTicket(client, {
        customerId: req.user.id, serviceId: data.service_id, barberId: data.barber_id ?? null,
        source: data.source, actorId: req.user.id,
      });
      return { free: true, issued };
    }

    const { rows } = await client.query(
      `INSERT INTO payments (ref_code, customer_id, service_id, barber_id, source, amount, promptpay_id, expires_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7, NOW() + ($8 || ' minutes')::INTERVAL)
       RETURNING id`,
      [newRefCode(), req.user.id, data.service_id, data.barber_id ?? null, data.source,
        svc[0].price, config.payment.promptpayId, String(config.payment.expireMinutes)],
    );
    return { id: rows[0].id };
  });

  if (result.free) {
    return res.status(201).json({ payment: null, ...(await ticketResponse(result.issued)) });
  }

  const payment = await loadPayment({ query }, result.id);
  broadcast('payment:update', { id: payment.id, status: payment.status });
  res.status(201).json({ payment: await withQr(payment) });
});

/** GET /api/payments/current — รายการที่ยังค้างจ่ายของฉัน (ใช้ตอนกลับมาหน้าเดิม) */
export const currentPayment = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `${PAYMENT_SELECT}
      WHERE p.customer_id = $1 AND p.status = 'pending'
      ORDER BY p.created_at DESC LIMIT 1`,
    [req.user.id],
  );
  res.json({ payment: rows[0] ? await withQr(rows[0]) : null });
});

/** GET /api/payments/:id */
export const getPayment = asyncHandler(async (req, res) => {
  const payment = await loadPayment({ query }, req.params.id);
  assertOwnerOrStaff(req, payment);
  res.json({ payment: await withQr(payment) });
});

/** POST /api/payments/:id/cancel */
export const cancelPayment = asyncHandler(async (req, res) => {
  const payment = await loadPayment({ query }, req.params.id);
  assertOwnerOrStaff(req, payment);
  if (payment.status !== 'pending') throw ApiError.conflict('ยกเลิกได้เฉพาะรายการที่ยังไม่ได้ชำระ');
  await query(`UPDATE payments SET status = 'cancelled' WHERE id = $1 AND status = 'pending'`, [payment.id]);
  broadcast('payment:update', { id: payment.id, status: 'cancelled' });
  res.json({ message: 'ยกเลิกรายการชำระเงินแล้ว' });
});

/**
 * ทำรายการ "ชำระแล้ว" + ออกบัตรคิว ใน transaction เดียว
 * ถ้าออกบัตรไม่ได้ (เช่น มีคิวค้างอยู่) ยังบันทึกว่าจ่ายแล้ว เพื่อให้พนักงานคืนเงิน/ออกบัตรให้เอง
 */
async function markPaidAndIssue(paymentId, fields, actorId) {
  return withTransaction(async (client) => {
    const p = await loadPayment(client, paymentId, true);
    if (!p) throw ApiError.notFound('ไม่พบรายการชำระเงิน');
    if (p.status === 'paid') throw ApiError.conflict('รายการนี้ชำระเงินเรียบร้อยแล้ว');
    if (!['pending', 'expired', 'failed'].includes(p.status)) throw ApiError.conflict('รายการนี้ถูกยกเลิกไปแล้ว');

    await client.query(
      `UPDATE payments
          SET status = 'paid', paid_at = NOW(), fail_reason = NULL,
              method = $2, slip_provider = $3, slip_trans_ref = $4, slip_amount = $5,
              slip_paid_at = $6, slip_data = $7, approved_by = $8
        WHERE id = $1`,
      [p.id, fields.method, fields.provider ?? null, fields.transRef ?? null, fields.amount ?? null,
        fields.paidAt ?? null, fields.raw ? JSON.stringify(fields.raw) : null, fields.approvedBy ?? null],
    );

    let issued = null;
    let issueError = null;
    await client.query('SAVEPOINT issue_ticket');
    try {
      issued = await issueTicket(client, {
        customerId: p.customer_id, serviceId: p.service_id, barberId: p.barber_id,
        source: p.source, actorId: actorId ?? p.customer_id,
      });
      await client.query('UPDATE payments SET ticket_id = $2 WHERE id = $1', [p.id, issued.ticket.id]);
      await client.query('RELEASE SAVEPOINT issue_ticket');
    } catch (err) {
      await client.query('ROLLBACK TO SAVEPOINT issue_ticket');
      issueError = err.message;
      await client.query(
        `UPDATE payments SET fail_reason = $2 WHERE id = $1`,
        [p.id, `ชำระแล้วแต่ออกบัตรคิวไม่สำเร็จ: ${issueError}`],
      );
    }

    // แจ้งลูกค้าผ่าน LINE
    const { rows: u } = await client.query('SELECT line_user_id FROM users WHERE id = $1', [p.customer_id]);
    if (u[0]?.line_user_id && lineEnabled()) {
      const t = issued?.ticket;
      onCommit(client, () => pushMessage(u[0].line_user_id, queueCard({
        title: '✓ ชำระเงินแล้ว',
        message: t
          ? `รอโดยประมาณ ${t.estimated_wait_min ?? 0} นาที ระบบจะแจ้งเตือนทาง LINE เมื่อใกล้ถึงคิว`
          : 'ออกบัตรคิวอัตโนมัติไม่สำเร็จ กรุณาติดต่อพนักงานที่หน้าร้าน',
        ticketNo: t?.ticket_no,
        rows: [
          ['ยอดชำระ', `${Number(p.amount).toLocaleString('th-TH')} บาท`],
          ['เลขอ้างอิง', p.ref_code],
          ...(t ? [['บริการ', t.service_name], ['ลำดับที่', t.position ?? '—']] : []),
        ],
        tone: 'ok',
      })));
    }

    onCommit(client, () => broadcast('payment:update', { id: p.id, status: 'paid' }));
    return { issued, issueError };
  });
}

/** POST /api/payments/:id/slip — อัปโหลดสลิปเพื่อตรวจสอบ { image: dataURL/base64 } */
export const submitSlip = asyncHandler(async (req, res) => {
  const payment = await loadPayment({ query }, req.params.id);
  assertOwnerOrStaff(req, payment);
  if (payment.status === 'paid') throw ApiError.conflict('รายการนี้ชำระเงินเรียบร้อยแล้ว');
  if (payment.status === 'cancelled') throw ApiError.conflict('รายการนี้ถูกยกเลิกแล้ว กรุณาทำรายการใหม่');
  if (payment.verify_attempts >= MAX_VERIFY_ATTEMPTS) {
    throw ApiError.conflict('ตรวจสลิปเกินจำนวนครั้งที่กำหนด กรุณาติดต่อพนักงาน');
  }

  // ต้องเป็นรูปจริง (JPEG/PNG/WEBP/GIF) ก่อนส่งไปตรวจ — พนักงานต้องเปิดดูสลิปนี้ย้อนหลังได้
  if (req.body?.image && !decodeSlipImage(req.body.image)) {
    throw new ApiError(422, 'ไฟล์ที่แนบไม่ใช่รูปภาพ กรุณาแนบรูปสลิป (JPG หรือ PNG)', { code: 'not_image' });
  }

  await query('UPDATE payments SET verify_attempts = verify_attempts + 1 WHERE id = $1', [payment.id]);

  let slip;
  try {
    slip = await verifySlip({
      image: req.body?.image,
      expectedAmount: Number(payment.amount),
      notBefore: new Date(payment.created_at),
    });
  } catch (err) {
    if (err instanceof SlipError) {
      await query(`UPDATE payments SET fail_reason = $2 WHERE id = $1`, [payment.id, err.message]);
      await saveSlip(payment.id, req.body?.image, { ok: false, reason: err.message, userId: req.user.id });
      throw new ApiError(422, err.message, { code: err.code, retryable: err.retryable });
    }
    throw err;
  }

  let result;
  try {
    result = await markPaidAndIssue(payment.id, {
      method: 'promptpay',
      provider: slipProviderName(),
      transRef: slip.transRef,
      amount: slip.amount,
      paidAt: slip.paidAt,
      raw: slip.raw,
    }, payment.customer_id);
  } catch (err) {
    if (err.code === '23505' && err.constraint === 'uniq_payments_trans_ref') {
      await saveSlip(payment.id, req.body?.image, { ok: false, reason: 'สลิปนี้ถูกใช้ชำระเงินไปแล้ว', userId: req.user.id });
      throw new ApiError(422, 'สลิปนี้ถูกใช้ชำระเงินไปแล้ว', { code: 'duplicate_slip' });
    }
    throw err;
  }
  await saveSlip(payment.id, req.body?.image, { ok: true, userId: req.user.id });

  const fresh = await loadPayment({ query }, payment.id);
  if (!result.issued) {
    return res.status(409).json({
      error: `ชำระเงินสำเร็จ แต่ออกบัตรคิวไม่ได้ (${result.issueError}) กรุณาติดต่อพนักงาน`,
      payment: publicPayment(fresh),
    });
  }
  res.json({
    message: `ชำระเงินสำเร็จ ได้รับบัตรคิว ${result.issued.ticket.ticket_no}`,
    payment: publicPayment(fresh),
    ...(await ticketResponse(result.issued)),
  });
});

/* ======================= พนักงาน ======================= */

/** GET /api/payments?date=&status= */
export const listPayments = asyncHandler(async (req, res) => {
  const date = req.query.date || shopToday();
  const params = [date];
  let statusSql = '';
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    statusSql = `AND p.status = ANY($2::payment_status[])`;
  }
  const { rows } = await query(
    `${PAYMENT_SELECT}
      WHERE (p.created_at AT TIME ZONE '${config.timezone}')::date = $1::date ${statusSql}
      ORDER BY p.created_at DESC`,
    params,
  );
  const data = rows.map(publicPayment);
  const summary = {
    total: data.length,
    paid: data.filter((p) => p.status === 'paid').length,
    pending: data.filter((p) => p.status === 'pending').length,
    revenue: data.filter((p) => p.status === 'paid').reduce((s, p) => s + Number(p.amount), 0),
    needs_attention: data.filter((p) => p.status === 'paid' && !p.ticket_id).length,
  };
  res.json({ data, summary, date });
});

/**
 * GET /api/payments/history?from=&to=&search=&status=&page=&limit=
 * ประวัติการโอนของลูกค้าย้อนหลัง (ข้ามวันได้) พร้อมจำนวนสลิปที่แนบมา
 */
export const paymentHistory = asyncHandler(async (req, res) => {
  const page = Math.max(Number(req.query.page) || 1, 1);
  const limit = Math.min(Math.max(Number(req.query.limit) || 20, 1), 100);
  const isDate = (v) => typeof v === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(v);
  const to = isDate(req.query.to) ? req.query.to : shopToday();
  const from = isDate(req.query.from) ? req.query.from : to;

  const params = [from, to, config.timezone];
  const where = [`(p.created_at AT TIME ZONE $3)::date BETWEEN $1::date AND $2::date`];
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where.push(`p.status = ANY($${params.length}::payment_status[])`);
  } else {
    // รายการที่ลูกค้าเปลี่ยนใจยกเลิกเองโดยไม่เคยส่งสลิป ไม่ใช่ "การโอน" ไม่ต้องแสดง
    where.push(`(p.status <> 'cancelled' OR EXISTS (SELECT 1 FROM payment_slips ps WHERE ps.payment_id = p.id))`);
  }
  if (req.query.search) {
    params.push(`%${String(req.query.search).trim()}%`);
    const n = params.length;
    where.push(`(cu.full_name ILIKE $${n} OR cu.line_display_name ILIKE $${n}
                 OR cu.phone ILIKE $${n} OR p.ref_code ILIKE $${n} OR p.slip_trans_ref ILIKE $${n})`);
  }

  params.push(limit, (page - 1) * limit);
  const { rows } = await query(
    `SELECT p.id, p.ref_code, p.status, p.method, p.amount, p.slip_amount, p.slip_trans_ref,
            p.slip_paid_at, p.paid_at, p.created_at, p.fail_reason, p.ticket_id,
            s.name AS service_name, q.ticket_no,
            cu.id AS customer_id, cu.full_name AS customer_name, cu.phone AS customer_phone,
            cu.line_display_name, cu.line_picture_url,
            ab.full_name AS approved_by_name,
            (SELECT COUNT(*)::int FROM payment_slips ps WHERE ps.payment_id = p.id) AS slip_count,
            COUNT(*) OVER() AS total_count,
            SUM(CASE WHEN p.status = 'paid' THEN p.amount ELSE 0 END) OVER() AS total_paid
       FROM payments p
       JOIN services s ON s.id = p.service_id
       JOIN users cu   ON cu.id = p.customer_id
       LEFT JOIN users ab ON ab.id = p.approved_by
       LEFT JOIN queue_tickets q ON q.id = p.ticket_id
      WHERE ${where.join(' AND ')}
      ORDER BY p.created_at DESC
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params,
  );

  const total = Number(rows[0]?.total_count ?? 0);
  res.json({
    data: rows.map(({ total_count: _t, total_paid: _p, ...r }) => r),
    summary: { total, paid_amount: Number(rows[0]?.total_paid ?? 0) },
    pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    from, to,
  });
});

/** GET /api/payments/:id/slips — รูปสลิปทุกใบของรายการนี้ (ใหม่สุดก่อน) */
export const paymentSlips = asyncHandler(async (req, res) => {
  const payment = await loadPayment({ query }, req.params.id);
  if (!payment) throw ApiError.notFound('ไม่พบรายการชำระเงิน');
  const { rows } = await query(
    `SELECT ps.id, ps.mime, ps.image, ps.ok, ps.reason, ps.created_at, u.full_name AS uploaded_by_name
       FROM payment_slips ps LEFT JOIN users u ON u.id = ps.uploaded_by
      WHERE ps.payment_id = $1 ORDER BY ps.id DESC LIMIT 20`,
    [payment.id],
  );
  res.json({
    payment: publicPayment(payment),
    slips: rows.map(({ image, mime, ...r }) => ({ ...r, image: `data:${mime};base64,${image.toString('base64')}` })),
  });
});

/** POST /api/payments/:id/approve — พนักงานยืนยันการชำระเงินเอง { method: 'manual'|'cash', note } */
export const approvePayment = asyncHandler(async (req, res) => {
  const method = req.body?.method === 'cash' ? 'cash' : 'manual';
  const payment = await loadPayment({ query }, req.params.id);
  if (!payment) throw ApiError.notFound('ไม่พบรายการชำระเงิน');

  // จ่ายแล้วแต่ยังไม่มีบัตรคิว -> ลองออกบัตรใหม่อีกครั้ง
  if (payment.status === 'paid' && !payment.ticket_id) {
    const issued = await withTransaction(async (client) => {
      const t = await issueTicket(client, {
        customerId: payment.customer_id, serviceId: payment.service_id, barberId: payment.barber_id,
        source: payment.source, actorId: req.user.id,
      });
      await client.query('UPDATE payments SET ticket_id = $2, fail_reason = NULL WHERE id = $1', [payment.id, t.ticket.id]);
      return t;
    });
    return res.json({ message: `ออกบัตรคิว ${issued.ticket.ticket_no} ให้แล้ว`, ticket: issued.ticket });
  }

  const result = await markPaidAndIssue(payment.id, { method, approvedBy: req.user.id }, req.user.id);
  if (!result.issued) throw ApiError.conflict(`บันทึกการชำระเงินแล้ว แต่ออกบัตรคิวไม่ได้: ${result.issueError}`);
  res.json({ message: `ยืนยันการชำระเงินและออกบัตรคิว ${result.issued.ticket.ticket_no} แล้ว`, ticket: result.issued.ticket });
});
