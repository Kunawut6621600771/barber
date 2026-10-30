/**
 * Module: POS — ขายหน้าร้าน
 *
 *   บิลหนึ่งใบมีได้ทั้งค่าบริการ (ตัดผม) และสินค้า (แว็กซ์ แชมพู)
 *   จ่ายได้หลายวิธีในบิลเดียว (เงินสด + QR + บัตร) ตัดสต็อกและสะสมแต้มให้อัตโนมัติ
 *
 *   GET    /api/pos/sales                  ประวัติบิล
 *   POST   /api/pos/sales                  เปิดบิลใหม่ (ผูกคิวได้)
 *   GET    /api/pos/sales/:id              รายละเอียดบิล
 *   PATCH  /api/pos/sales/:id              แก้หัวบิล (ลูกค้า ส่วนลด แต้ม หมายเหตุ)
 *   POST   /api/pos/sales/:id/items        เพิ่มรายการ
 *   PATCH  /api/pos/sales/:id/items/:itemId แก้จำนวน/ส่วนลดรายบรรทัด
 *   DELETE /api/pos/sales/:id/items/:itemId ลบรายการ
 *   POST   /api/pos/sales/:id/checkout     ชำระเงิน ปิดบิล
 *   POST   /api/pos/sales/:id/void         ยกเลิกบิล
 *   POST   /api/pos/sales/:id/refund       คืนเงิน
 *   GET    /api/pos/sales/:id/receipt      ข้อมูลสำหรับพิมพ์ใบเสร็จ
 *   POST   /api/pos/promo/check            ตรวจโค้ดส่วนลด
 */
import { query, withTransaction, shopToday } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { broadcast } from '../utils/realtime.js';
import { getSettings, loyaltyConfig, num } from '../utils/settings.js';
import { moveStock } from './products.controller.js';

const ACTIVE_STATUSES = ['paid', 'partial_refund', 'refunded'];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/* ------------------------------------------------------------------ */
/*  helper                                                            */
/* ------------------------------------------------------------------ */

async function loadSale(client, id) {
  const run = client ? client.query.bind(client) : query;

  const { rows } = await run('SELECT * FROM v_sale_detail WHERE id = $1', [id]);
  const sale = rows[0];
  if (!sale) throw ApiError.notFound('ไม่พบบิลนี้');

  const [items, payments, refunds] = await Promise.all([
    run(
      `SELECT si.*, bu.full_name AS barber_name
         FROM sale_items si
         LEFT JOIN barbers b  ON b.id  = si.barber_id
         LEFT JOIN users   bu ON bu.id = b.user_id
        WHERE si.sale_id = $1 ORDER BY si.id`,
      [id],
    ),
    run('SELECT * FROM sale_payments WHERE sale_id = $1 ORDER BY id', [id]),
    run(
      `SELECT r.*, u.full_name AS actor_name
         FROM sale_refunds r LEFT JOIN users u ON u.id = r.actor_id
        WHERE r.sale_id = $1 ORDER BY r.id`,
      [id],
    ),
  ]);

  return { ...sale, items: items.rows, payments: payments.rows, refunds: refunds.rows };
}

/** ล็อกบิลและบังคับว่าต้องยังเปิดอยู่ */
async function lockOpenSale(client, id) {
  const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [id]);
  const sale = rows[0];
  if (!sale) throw ApiError.notFound('ไม่พบบิลนี้');
  if (sale.status !== 'open') throw ApiError.conflict('บิลนี้ปิดการขายไปแล้ว แก้ไขรายการไม่ได้');
  return sale;
}

const recalc = (client, saleId) => client.query('SELECT recalc_sale($1)', [saleId]);

/** กะที่เปิดอยู่ตอนนี้ (ถ้ามี) */
async function openShiftId(client) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run(`SELECT id FROM cash_shifts WHERE status = 'open' LIMIT 1`);
  return rows[0]?.id ?? null;
}

/** ตรวจโค้ดส่วนลดว่าใช้ได้ไหมกับยอด subtotal นี้ */
async function resolvePromo(client, code, subtotal) {
  const run = client ? client.query.bind(client) : query;
  const { rows } = await run('SELECT * FROM promo_codes WHERE UPPER(code) = UPPER($1)', [code]);
  const p = rows[0];

  if (!p) throw ApiError.notFound('ไม่พบโค้ดส่วนลดนี้');
  if (!p.is_active) throw ApiError.badRequest('โค้ดส่วนลดนี้ถูกปิดใช้งานแล้ว');
  if (p.starts_at && new Date(p.starts_at) > new Date()) throw ApiError.badRequest('โค้ดส่วนลดนี้ยังไม่เริ่มใช้งาน');
  if (p.ends_at && new Date(p.ends_at) < new Date()) throw ApiError.badRequest('โค้ดส่วนลดนี้หมดอายุแล้ว');
  if (p.max_uses !== null && p.used_count >= p.max_uses) throw ApiError.badRequest('โค้ดส่วนลดนี้ถูกใช้ครบจำนวนแล้ว');
  if (subtotal < p.min_total) {
    throw ApiError.badRequest(`โค้ดนี้ใช้ได้เมื่อยอดตั้งแต่ ${p.min_total.toLocaleString('th-TH')} บาทขึ้นไป`);
  }

  let amount = p.discount_type === 'percent' ? round2(subtotal * p.discount_value / 100) : Number(p.discount_value);
  if (p.max_discount !== null) amount = Math.min(amount, Number(p.max_discount));
  amount = Math.min(amount, subtotal);

  return { promo: p, amount };
}

/* ------------------------------------------------------------------ */
/*  อ่านบิล                                                            */
/* ------------------------------------------------------------------ */

export const listSales = asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.from) { params.push(req.query.from); where.push(`sale_date >= $${params.length}`); }
  if (req.query.to) { params.push(req.query.to); where.push(`sale_date <= $${params.length}`); }
  if (req.query.date) { params.push(req.query.date); where.push(`sale_date = $${params.length}`); }
  if (req.query.status) {
    params.push(String(req.query.status).split(','));
    where.push(`status = ANY($${params.length}::sale_status[])`);
  }
  if (req.query.shift_id) { params.push(req.query.shift_id); where.push(`shift_id = $${params.length}`); }
  if (req.query.customer_id) { params.push(req.query.customer_id); where.push(`customer_id = $${params.length}`); }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(bill_no ILIKE $${params.length} OR customer_name ILIKE $${params.length})`);
  }

  const limit = Math.min(Number(req.query.limit) || 50, 200);
  const sql = `SELECT * FROM v_sale_detail
                ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
                ORDER BY created_at DESC LIMIT ${limit}`;

  const [list, totals] = await Promise.all([
    query(sql, params),
    query(
      `SELECT COUNT(*)::int AS bills,
              COALESCE(SUM(total), 0)           AS total,
              COALESCE(SUM(refunded_amount), 0) AS refunded
         FROM v_sale_detail
        ${where.length ? `WHERE ${where.join(' AND ')} AND` : 'WHERE'} status = ANY($${params.length + 1}::sale_status[])`,
      [...params, ACTIVE_STATUSES],
    ),
  ]);

  res.json({ data: list.rows, summary: totals.rows[0] });
});

export const getSale = asyncHandler(async (req, res) => {
  res.json({ sale: await loadSale(null, req.params.id) });
});

/** บิลที่ยังเปิดค้างอยู่ (หน้าจอ POS เอาไว้เลือกกลับมาทำต่อ) */
export const openSales = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT * FROM v_sale_detail WHERE status = 'open' ORDER BY created_at`,
  );
  res.json({ data: rows });
});

/* ------------------------------------------------------------------ */
/*  เปิดบิล / แก้หัวบิล                                                 */
/* ------------------------------------------------------------------ */

export const createSale = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    customer_id: { type: 'int', label: 'ลูกค้า' },
    guest_name: { type: 'string', max: 150, label: 'ชื่อลูกค้า' },
    guest_phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    ticket_id: { type: 'int', label: 'คิว' },
    barber_id: { type: 'int', label: 'ช่าง' },
    note: { type: 'string', max: 500, label: 'หมายเหตุ' },
  });

  const settings = await getSettings();

  const sale = await withTransaction(async (client) => {
    let { customer_id: customerId, guest_name: guestName, barber_id: barberId } = d;
    let ticketId = d.ticket_id ?? null;

    // เปิดบิลจากคิว: ดึงลูกค้า/ช่าง/บริการจากคิวมาให้เลย
    if (ticketId) {
      const { rows: tk } = await client.query('SELECT * FROM v_queue_board WHERE id = $1', [ticketId]);
      const ticket = tk[0];
      if (!ticket) throw ApiError.notFound('ไม่พบคิวนี้');

      const { rows: dup } = await client.query(
        `SELECT id, bill_no FROM sales WHERE ticket_id = $1 AND status <> 'void'`, [ticketId],
      );
      if (dup.length) throw ApiError.conflict(`คิวนี้มีบิล ${dup[0].bill_no} อยู่แล้ว`);

      customerId ??= ticket.customer_id;
      guestName ??= ticket.customer_id ? null : ticket.customer_name;
      barberId ??= ticket.barber_id;
    }

    const billNo = (await client.query('SELECT next_bill_no($1) AS no', [shopToday()])).rows[0].no;

    const { rows } = await client.query(
      `INSERT INTO sales (bill_no, sale_date, shift_id, customer_id, guest_name, guest_phone,
                          ticket_id, barber_id, cashier_id, tax_rate, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING id`,
      [billNo, shopToday(), await openShiftId(client), customerId ?? null, guestName ?? null,
        d.guest_phone ?? null, ticketId, barberId ?? null, req.user.id,
        num(settings.tax_rate, 0), d.note ?? null],
    );
    const saleId = rows[0].id;

    // ผูกคิว -> ใส่ค่าบริการของคิวเป็นรายการแรกให้อัตโนมัติ
    if (ticketId) {
      const { rows: tk } = await client.query(
        `SELECT q.service_id, s.name, s.price FROM queue_tickets q
           JOIN services s ON s.id = q.service_id WHERE q.id = $1`,
        [ticketId],
      );
      const svc = tk[0];
      await client.query(
        `INSERT INTO sale_items (sale_id, kind, service_id, name, unit_price, qty, line_total, barber_id)
         VALUES ($1,'service',$2,$3,$4,1,$4,$5)`,
        [saleId, svc.service_id, svc.name, svc.price, barberId ?? null],
      );
      await recalc(client, saleId);
    }

    return loadSale(client, saleId);
  });

  broadcast('pos:sale', { id: sale.id, status: sale.status });
  res.status(201).json({ sale, message: `เปิดบิล ${sale.bill_no} แล้ว` });
});

export const updateSale = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    customer_id: { type: 'int', label: 'ลูกค้า' },
    guest_name: { type: 'string', max: 150, label: 'ชื่อลูกค้า' },
    guest_phone: { type: 'phone', label: 'เบอร์โทรศัพท์' },
    barber_id: { type: 'int', label: 'ช่าง' },
    discount_type: { type: 'enum', enum: ['amount', 'percent'], label: 'ชนิดส่วนลด' },
    discount_value: { type: 'number', min: 0, label: 'ส่วนลด' },
    promo_code: { type: 'string', max: 30, label: 'โค้ดส่วนลด' },
    points_used: { type: 'int', min: 0, label: 'แต้มที่ใช้' },
    tax_rate: { type: 'number', min: 0, label: 'อัตราภาษี' },
    note: { type: 'string', max: 500, label: 'หมายเหตุ' },
  });

  const sale = await withTransaction(async (client) => {
    const current = await lockOpenSale(client, req.params.id);

    const customerId = 'customer_id' in req.body ? (d.customer_id ?? null) : current.customer_id;
    let discountType = 'discount_type' in req.body ? (d.discount_type ?? null) : current.discount_type;
    let discountValue = 'discount_value' in req.body ? (d.discount_value ?? 0) : current.discount_value;
    let promoCode = 'promo_code' in req.body ? (d.promo_code || null) : current.promo_code;

    const { rows: sub } = await client.query(
      'SELECT COALESCE(SUM(line_total),0) AS subtotal FROM sale_items WHERE sale_id = $1', [current.id],
    );
    const subtotal = Number(sub[0].subtotal);

    // ใส่โค้ดส่วนลด -> แปลงเป็นส่วนลดของบิล (ทับส่วนลดที่กรอกมือ)
    if (promoCode) {
      const { promo } = await resolvePromo(client, promoCode, subtotal);
      promoCode = promo.code;
      discountType = promo.discount_type;
      discountValue = promo.discount_value;
      if (promo.max_discount !== null && promo.discount_type === 'percent') {
        // แปลงเป็นส่วนลดบาทเมื่อมีเพดาน เพื่อให้ recalc_sale คิดได้ตรง
        const raw = round2(subtotal * Number(promo.discount_value) / 100);
        if (raw > Number(promo.max_discount)) {
          discountType = 'amount';
          discountValue = Number(promo.max_discount);
        }
      }
    }

    // ใช้แต้มได้เฉพาะลูกค้าที่เป็นสมาชิก และต้องมีแต้มพอ
    let pointsUsed = 'points_used' in req.body ? (d.points_used ?? 0) : current.points_used;
    let pointsDiscount = 0;
    const loyalty = await loyaltyConfig(client);

    if (pointsUsed > 0) {
      if (!loyalty.enabled) throw ApiError.badRequest('ร้านปิดระบบสะสมแต้มอยู่');
      if (!customerId) throw ApiError.badRequest('ต้องเลือกลูกค้าที่เป็นสมาชิกก่อนจึงจะใช้แต้มได้');

      const { rows: u } = await client.query('SELECT loyalty_points FROM users WHERE id = $1', [customerId]);
      if (!u[0]) throw ApiError.notFound('ไม่พบลูกค้าคนนี้');
      if (u[0].loyalty_points < pointsUsed) {
        throw ApiError.badRequest(`ลูกค้ามีแต้มคงเหลือ ${u[0].loyalty_points} แต้ม ไม่พอใช้ ${pointsUsed} แต้ม`);
      }
      if (pointsUsed < loyalty.minRedeem) {
        throw ApiError.badRequest(`ต้องใช้อย่างน้อย ${loyalty.minRedeem} แต้มต่อครั้ง`);
      }
      pointsDiscount = round2(pointsUsed * loyalty.pointValueBaht);
    } else {
      pointsUsed = 0;
    }

    await client.query(
      `UPDATE sales
          SET customer_id = $2, guest_name = $3, guest_phone = $4, barber_id = $5,
              discount_type = $6, discount_value = $7, promo_code = $8,
              points_used = $9, points_discount = $10,
              tax_rate = $11, note = $12
        WHERE id = $1`,
      [
        current.id,
        customerId,
        'guest_name' in req.body ? (d.guest_name ?? null) : current.guest_name,
        'guest_phone' in req.body ? (d.guest_phone ?? null) : current.guest_phone,
        'barber_id' in req.body ? (d.barber_id ?? null) : current.barber_id,
        discountType, discountValue || 0, promoCode,
        pointsUsed, pointsDiscount,
        'tax_rate' in req.body ? (d.tax_rate ?? 0) : current.tax_rate,
        'note' in req.body ? (d.note ?? null) : current.note,
      ],
    );
    await recalc(client, current.id);
    return loadSale(client, current.id);
  });

  res.json({ sale });
});

/* ------------------------------------------------------------------ */
/*  รายการในบิล                                                        */
/* ------------------------------------------------------------------ */

export const addItem = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    kind: { type: 'enum', enum: ['service', 'product'], required: true, label: 'ชนิดรายการ' },
    service_id: { type: 'int', label: 'บริการ' },
    product_id: { type: 'int', label: 'สินค้า' },
    qty: { type: 'int', min: 1, max: 999, default: 1, label: 'จำนวน' },
    unit_price: { type: 'number', min: 0, label: 'ราคาต่อหน่วย' },
    discount_amount: { type: 'number', min: 0, default: 0, label: 'ส่วนลด' },
    barber_id: { type: 'int', label: 'ช่าง' },
    note: { type: 'string', max: 200, label: 'หมายเหตุ' },
  });

  const sale = await withTransaction(async (client) => {
    const current = await lockOpenSale(client, req.params.id);

    let name;
    let price;

    if (d.kind === 'service') {
      if (!d.service_id) throw ApiError.badRequest('กรุณาเลือกบริการ');
      const { rows } = await client.query(
        'SELECT name, price FROM services WHERE id = $1 AND is_active = TRUE', [d.service_id],
      );
      if (!rows[0]) throw ApiError.badRequest('ไม่พบบริการนี้ หรือบริการถูกปิดอยู่');
      ({ name, price } = rows[0]);
    } else {
      if (!d.product_id) throw ApiError.badRequest('กรุณาเลือกสินค้า');
      const { rows } = await client.query(
        'SELECT name, price, stock_qty, track_stock FROM products WHERE id = $1 AND is_active = TRUE',
        [d.product_id],
      );
      if (!rows[0]) throw ApiError.badRequest('ไม่พบสินค้านี้ หรือสินค้าถูกปิดการขาย');
      ({ name, price } = rows[0]);

      // เตือนตั้งแต่ตอนหยิบใส่บิล (ตัดสต็อกจริงตอนชำระเงิน)
      if (rows[0].track_stock) {
        const { rows: inCart } = await client.query(
          `SELECT COALESCE(SUM(qty),0)::int AS n FROM sale_items si
             JOIN sales s ON s.id = si.sale_id
            WHERE si.product_id = $1 AND s.status = 'open'`,
          [d.product_id],
        );
        if (inCart[0].n + d.qty > rows[0].stock_qty) {
          throw ApiError.conflict(`"${name}" คงเหลือ ${rows[0].stock_qty} ชิ้น (อยู่ในบิลที่เปิดค้าง ${inCart[0].n} ชิ้น)`);
        }
      }
    }

    const unitPrice = d.unit_price ?? Number(price);
    const lineTotal = round2(Math.max(unitPrice * d.qty - (d.discount_amount ?? 0), 0));

    await client.query(
      `INSERT INTO sale_items (sale_id, kind, service_id, product_id, name,
                               unit_price, qty, discount_amount, line_total, barber_id, note)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
      [current.id, d.kind, d.kind === 'service' ? d.service_id : null,
        d.kind === 'product' ? d.product_id : null, name,
        unitPrice, d.qty, d.discount_amount ?? 0, lineTotal,
        d.barber_id ?? (d.kind === 'service' ? current.barber_id : null), d.note ?? null],
    );
    await recalc(client, current.id);
    return loadSale(client, current.id);
  });

  res.status(201).json({ sale });
});

export const updateItem = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    qty: { type: 'int', min: 1, max: 999, label: 'จำนวน' },
    unit_price: { type: 'number', min: 0, label: 'ราคาต่อหน่วย' },
    discount_amount: { type: 'number', min: 0, label: 'ส่วนลด' },
    barber_id: { type: 'int', label: 'ช่าง' },
  });

  const sale = await withTransaction(async (client) => {
    const current = await lockOpenSale(client, req.params.id);

    const { rows } = await client.query(
      'SELECT * FROM sale_items WHERE id = $1 AND sale_id = $2', [req.params.itemId, current.id],
    );
    const item = rows[0];
    if (!item) throw ApiError.notFound('ไม่พบรายการนี้ในบิล');

    const qty = d.qty ?? item.qty;
    const unitPrice = d.unit_price ?? Number(item.unit_price);
    const discount = d.discount_amount ?? Number(item.discount_amount);
    const lineTotal = round2(Math.max(unitPrice * qty - discount, 0));

    await client.query(
      `UPDATE sale_items
          SET qty = $2, unit_price = $3, discount_amount = $4, line_total = $5, barber_id = $6
        WHERE id = $1`,
      [item.id, qty, unitPrice, discount, lineTotal,
        'barber_id' in req.body ? (d.barber_id ?? null) : item.barber_id],
    );
    await recalc(client, current.id);
    return loadSale(client, current.id);
  });

  res.json({ sale });
});

export const removeItem = asyncHandler(async (req, res) => {
  const sale = await withTransaction(async (client) => {
    const current = await lockOpenSale(client, req.params.id);

    const { rowCount } = await client.query(
      'DELETE FROM sale_items WHERE id = $1 AND sale_id = $2', [req.params.itemId, current.id],
    );
    if (!rowCount) throw ApiError.notFound('ไม่พบรายการนี้ในบิล');

    await recalc(client, current.id);
    return loadSale(client, current.id);
  });

  res.json({ sale });
});

/* ------------------------------------------------------------------ */
/*  ชำระเงิน                                                           */
/* ------------------------------------------------------------------ */

export const checkout = asyncHandler(async (req, res) => {
  const payments = Array.isArray(req.body?.payments) ? req.body.payments : [];
  if (!payments.length) throw ApiError.badRequest('กรุณาระบุวิธีชำระเงินอย่างน้อย 1 รายการ');

  const parsed = payments.map((p, i) => validate(p, {
    method: {
      type: 'enum', enum: ['cash', 'promptpay', 'card', 'transfer', 'other'],
      required: true, label: `วิธีชำระเงินรายการที่ ${i + 1}`,
    },
    amount: { type: 'number', min: 0, required: true, label: `จำนวนเงินรายการที่ ${i + 1}` },
    received: { type: 'number', min: 0, label: 'เงินที่รับมา' },
    reference: { type: 'string', max: 120, label: 'เลขอ้างอิง' },
  }));
  if (parsed.some((p) => p.amount <= 0)) throw ApiError.badRequest('จำนวนเงินต้องมากกว่า 0');

  const finishTicket = req.body?.finish_ticket !== false;

  const result = await withTransaction(async (client) => {
    const current = await lockOpenSale(client, req.params.id);

    const { rows: itemRows } = await client.query(
      'SELECT * FROM sale_items WHERE sale_id = $1', [current.id],
    );
    if (!itemRows.length) throw ApiError.badRequest('บิลนี้ยังไม่มีรายการ');

    await recalc(client, current.id);
    const { rows: fresh } = await client.query('SELECT * FROM sales WHERE id = $1', [current.id]);
    const sale = fresh[0];

    const paidTotal = round2(parsed.reduce((sum, p) => sum + p.amount, 0));
    const total = Number(sale.total);
    if (paidTotal + 0.009 < total) {
      throw ApiError.badRequest(`ยอดชำระ ${paidTotal.toFixed(2)} บาท น้อยกว่ายอดที่ต้องจ่าย ${total.toFixed(2)} บาท`);
    }

    // เงินทอนคิดจากเงินสดเท่านั้น วิธีอื่นต้องจ่ายพอดี
    const cashPaid = round2(parsed.filter((p) => p.method === 'cash').reduce((s, p) => s + p.amount, 0));
    const nonCashPaid = round2(paidTotal - cashPaid);
    if (nonCashPaid > total + 0.009) {
      throw ApiError.badRequest('ยอดชำระแบบไม่ใช่เงินสดเกินยอดบิล กรุณาตรวจสอบอีกครั้ง');
    }
    const change = round2(Math.max(paidTotal - total, 0));

    // ตัดสต็อกสินค้า (ล็อกแถวสินค้าไว้แล้วใน moveStock)
    for (const item of itemRows.filter((i) => i.kind === 'product')) {
      await moveStock(client, {
        productId: item.product_id,
        changeQty: -item.qty,
        reason: 'sale',
        saleId: sale.id,
        note: `ขายตามบิล ${sale.bill_no}`,
        actorId: req.user.id,
      });
    }

    for (const p of parsed) {
      await client.query(
        `INSERT INTO sale_payments (sale_id, method, amount, received, reference, actor_id)
         VALUES ($1,$2,$3,$4,$5,$6)`,
        [sale.id, p.method, p.amount, p.received ?? null, p.reference ?? null, req.user.id],
      );
    }

    // แต้มสะสม: หักแต้มที่ใช้ แล้วบวกแต้มที่ได้จากยอดสุทธิ
    const loyalty = await loyaltyConfig(client);
    let pointsEarned = 0;

    if (sale.customer_id) {
      if (sale.points_used > 0) {
        const { rows: u } = await client.query(
          'UPDATE users SET loyalty_points = loyalty_points - $2 WHERE id = $1 RETURNING loyalty_points',
          [sale.customer_id, sale.points_used],
        );
        if (u[0].loyalty_points < 0) throw ApiError.badRequest('แต้มของลูกค้าไม่พอ');
        await client.query(
          `INSERT INTO loyalty_transactions (user_id, points, balance_after, reason, sale_id, note, actor_id)
           VALUES ($1,$2,$3,'redeem',$4,$5,$6)`,
          [sale.customer_id, -sale.points_used, u[0].loyalty_points, sale.id,
            `ใช้แต้มแทนเงิน ${sale.points_discount} บาท`, req.user.id],
        );
      }

      if (loyalty.enabled && loyalty.pointsPerBaht > 0) {
        pointsEarned = Math.floor(total * loyalty.pointsPerBaht);
        if (pointsEarned > 0) {
          const { rows: u } = await client.query(
            'UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1 RETURNING loyalty_points',
            [sale.customer_id, pointsEarned],
          );
          await client.query(
            `INSERT INTO loyalty_transactions (user_id, points, balance_after, reason, sale_id, note, actor_id)
             VALUES ($1,$2,$3,'earn',$4,$5,$6)`,
            [sale.customer_id, pointsEarned, u[0].loyalty_points, sale.id,
              `ได้รับจากบิล ${sale.bill_no}`, req.user.id],
          );
        }
      }

      await client.query(
        `UPDATE users
            SET total_spent   = total_spent + $2,
                visit_count   = visit_count + 1,
                last_visit_at = NOW(),
                member_tier   = member_tier_for(total_spent + $2)
          WHERE id = $1`,
        [sale.customer_id, total],
      );
    }

    if (sale.promo_code) {
      await client.query(
        'UPDATE promo_codes SET used_count = used_count + 1 WHERE UPPER(code) = UPPER($1)', [sale.promo_code],
      );
    }

    await client.query(
      `UPDATE sales
          SET status = 'paid', paid_at = NOW(), paid_total = $2, change_amount = $3,
              points_earned = $4, shift_id = COALESCE(shift_id, $5)
        WHERE id = $1`,
      [sale.id, paidTotal, change, pointsEarned, await openShiftId(client)],
    );

    // ปิดคิวที่ผูกกับบิลนี้ให้ด้วย ถ้ายังให้บริการค้างอยู่
    let closedTicket = null;
    if (finishTicket && sale.ticket_id) {
      const { rows: tk } = await client.query(
        `SELECT id, status, barber_id, ticket_no FROM queue_tickets WHERE id = $1 FOR UPDATE`, [sale.ticket_id],
      );
      if (tk[0] && ['serving', 'called'].includes(tk[0].status)) {
        await client.query(
          `UPDATE queue_tickets
              SET status = 'done', finished_at = NOW(), position = NULL,
                  started_at = COALESCE(started_at, NOW())
            WHERE id = $1`,
          [tk[0].id],
        );
        await client.query(
          `INSERT INTO queue_events (ticket_id, event_type, from_status, to_status, actor_id, note)
           VALUES ($1,'done',$2,'done',$3,$4)`,
          [tk[0].id, tk[0].status, req.user.id, `ปิดคิวอัตโนมัติจากบิล ${sale.bill_no}`],
        );
        if (tk[0].barber_id) {
          const { rows: busy } = await client.query(
            `SELECT 1 FROM queue_tickets WHERE barber_id = $1 AND status = 'serving' LIMIT 1`, [tk[0].barber_id],
          );
          if (!busy.length) {
            await client.query(`UPDATE barbers SET status = 'available' WHERE id = $1`, [tk[0].barber_id]);
          }
        }
        await client.query('SELECT reorder_queue($1)', [shopToday()]);
        closedTicket = tk[0].ticket_no;
      }
    }

    return { sale: await loadSale(client, sale.id), change, closedTicket };
  });

  broadcast('pos:paid', { id: result.sale.id, bill_no: result.sale.bill_no, total: result.sale.total });
  if (result.closedTicket) broadcast('queue:update', { queue_date: shopToday() });

  res.json({
    sale: result.sale,
    change: result.change,
    message: `ชำระเงินบิล ${result.sale.bill_no} เรียบร้อย${result.change > 0 ? ` · เงินทอน ${result.change.toFixed(2)} บาท` : ''}`,
  });
});

/* ------------------------------------------------------------------ */
/*  ยกเลิก / คืนเงิน                                                    */
/* ------------------------------------------------------------------ */

export const voidSale = asyncHandler(async (req, res) => {
  const reason = (req.body?.reason || '').trim() || null;

  const sale = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [req.params.id]);
    const current = rows[0];
    if (!current) throw ApiError.notFound('ไม่พบบิลนี้');
    if (current.status === 'void') throw ApiError.conflict('บิลนี้ถูกยกเลิกไปแล้ว');

    // บิลที่จ่ายแล้ว ต้องเป็นแอดมินเท่านั้นจึงยกเลิกได้ (และต้องคืนของ/คืนแต้ม)
    if (current.status !== 'open') {
      if (req.user.role !== 'admin') throw ApiError.forbidden('ยกเลิกบิลที่ชำระแล้วได้เฉพาะผู้ดูแลระบบ');
      if (!reason) throw ApiError.badRequest('กรุณาระบุเหตุผลในการยกเลิกบิลที่ชำระแล้ว');

      const { rows: items } = await client.query(
        `SELECT * FROM sale_items WHERE sale_id = $1 AND kind = 'product'`, [current.id],
      );
      for (const item of items) {
        await moveStock(client, {
          productId: item.product_id,
          changeQty: item.qty,
          reason: 'void',
          saleId: current.id,
          note: `คืนสต็อกจากการยกเลิกบิล ${current.bill_no}`,
          actorId: req.user.id,
        });
      }

      if (current.customer_id) {
        const net = current.points_used - current.points_earned;   // คืนแต้มที่ใช้ หักแต้มที่ได้
        if (net !== 0) {
          const { rows: u } = await client.query(
            'UPDATE users SET loyalty_points = GREATEST(loyalty_points + $2, 0) WHERE id = $1 RETURNING loyalty_points',
            [current.customer_id, net],
          );
          await client.query(
            `INSERT INTO loyalty_transactions (user_id, points, balance_after, reason, sale_id, note, actor_id)
             VALUES ($1,$2,$3,'refund',$4,$5,$6)`,
            [current.customer_id, net, u[0].loyalty_points, current.id,
              `ปรับแต้มจากการยกเลิกบิล ${current.bill_no}`, req.user.id],
          );
        }
        await client.query(
          `UPDATE users
              SET total_spent = GREATEST(total_spent - $2, 0),
                  visit_count = GREATEST(visit_count - 1, 0),
                  member_tier = member_tier_for(GREATEST(total_spent - $2, 0))
            WHERE id = $1`,
          [current.customer_id, current.total],
        );
      }

      if (current.promo_code) {
        await client.query(
          'UPDATE promo_codes SET used_count = GREATEST(used_count - 1, 0) WHERE UPPER(code) = UPPER($1)',
          [current.promo_code],
        );
      }
    }

    await client.query(
      `UPDATE sales SET status = 'void', void_reason = $2 WHERE id = $1`, [current.id, reason],
    );
    return loadSale(client, current.id);
  });

  broadcast('pos:sale', { id: sale.id, status: 'void' });
  res.json({ sale, message: `ยกเลิกบิล ${sale.bill_no} แล้ว` });
});

export const refundSale = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    amount: { type: 'number', min: 0, required: true, label: 'จำนวนเงินที่คืน' },
    method: { type: 'enum', enum: ['cash', 'promptpay', 'card', 'transfer', 'other'], default: 'cash', label: 'วิธีคืนเงิน' },
    reason: { type: 'string', max: 300, label: 'เหตุผล' },
    restock: { type: 'bool', default: true, label: 'คืนของเข้าสต็อก' },
  });
  if (d.amount <= 0) throw ApiError.badRequest('จำนวนเงินที่คืนต้องมากกว่า 0');

  const sale = await withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM sales WHERE id = $1 FOR UPDATE', [req.params.id]);
    const current = rows[0];
    if (!current) throw ApiError.notFound('ไม่พบบิลนี้');
    if (!ACTIVE_STATUSES.includes(current.status)) throw ApiError.conflict('คืนเงินได้เฉพาะบิลที่ชำระแล้วเท่านั้น');

    const remaining = round2(Number(current.total) - Number(current.refunded_amount));
    if (d.amount > remaining + 0.009) {
      throw ApiError.badRequest(`คืนได้ไม่เกิน ${remaining.toFixed(2)} บาท (บิลนี้คืนไปแล้ว ${Number(current.refunded_amount).toFixed(2)} บาท)`);
    }

    await client.query(
      `INSERT INTO sale_refunds (sale_id, amount, method, reason, restock, actor_id)
       VALUES ($1,$2,$3,$4,$5,$6)`,
      [current.id, d.amount, d.method, d.reason || null, d.restock, req.user.id],
    );

    // คืนเงินเต็มจำนวน -> คืนของเข้าสต็อกให้ด้วย (ถ้าเลือกไว้)
    const refunded = round2(Number(current.refunded_amount) + d.amount);
    const isFull = refunded >= Number(current.total) - 0.009;

    if (isFull && d.restock) {
      const { rows: items } = await client.query(
        `SELECT * FROM sale_items WHERE sale_id = $1 AND kind = 'product'`, [current.id],
      );
      for (const item of items) {
        await moveStock(client, {
          productId: item.product_id,
          changeQty: item.qty,
          reason: 'refund',
          saleId: current.id,
          note: `คืนสินค้าจากบิล ${current.bill_no}`,
          actorId: req.user.id,
        });
      }
    }

    await client.query(
      `UPDATE sales SET refunded_amount = $2, status = $3::sale_status WHERE id = $1`,
      [current.id, refunded, isFull ? 'refunded' : 'partial_refund'],
    );
    return loadSale(client, current.id);
  });

  res.json({ sale, message: `บันทึกการคืนเงิน ${d.amount.toFixed(2)} บาท เรียบร้อยแล้ว` });
});

/* ------------------------------------------------------------------ */
/*  ใบเสร็จ / โค้ดส่วนลด                                                */
/* ------------------------------------------------------------------ */

export const receipt = asyncHandler(async (req, res) => {
  const sale = await loadSale(null, req.params.id);
  const s = await getSettings();

  res.json({
    sale,
    shop: {
      name: s.shop_name,
      address: s.shop_address,
      phone: s.shop_phone,
      tax_id: s.tax_id,
      footer: s.receipt_footer,
    },
  });
});

export const checkPromo = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    code: { type: 'string', required: true, max: 30, label: 'โค้ดส่วนลด' },
    subtotal: { type: 'number', min: 0, required: true, label: 'ยอดก่อนลด' },
  });

  const { promo, amount } = await resolvePromo(null, d.code, d.subtotal);
  res.json({
    code: promo.code,
    description: promo.description,
    discount_type: promo.discount_type,
    discount_value: promo.discount_value,
    discount_amount: amount,
  });
});

/* ------------------------------------------------------------------ */
/*  โค้ดส่วนลด (จัดการ)                                                 */
/* ------------------------------------------------------------------ */

export const listPromos = asyncHandler(async (_req, res) => {
  const { rows } = await query('SELECT * FROM promo_codes ORDER BY is_active DESC, code');
  res.json({ data: rows });
});

const promoSchema = {
  code: { type: 'string', required: true, max: 30, label: 'โค้ด' },
  description: { type: 'string', max: 300, label: 'คำอธิบาย' },
  discount_type: { type: 'enum', enum: ['amount', 'percent'], required: true, label: 'ชนิดส่วนลด' },
  discount_value: { type: 'number', min: 0, required: true, label: 'มูลค่าส่วนลด' },
  min_total: { type: 'number', min: 0, default: 0, label: 'ยอดขั้นต่ำ' },
  max_discount: { type: 'number', min: 0, label: 'ส่วนลดสูงสุด' },
  max_uses: { type: 'int', min: 1, label: 'จำนวนครั้งที่ใช้ได้' },
  starts_at: { type: 'date', label: 'เริ่มใช้ได้' },
  ends_at: { type: 'date', label: 'ใช้ได้ถึง' },
  is_active: { type: 'bool', default: true, label: 'เปิดใช้งาน' },
};

export const createPromo = asyncHandler(async (req, res) => {
  const d = validate(req.body, promoSchema);
  if (d.discount_value <= 0) throw ApiError.badRequest('มูลค่าส่วนลดต้องมากกว่า 0');
  if (d.discount_type === 'percent' && d.discount_value > 100) throw ApiError.badRequest('ส่วนลดเป็นเปอร์เซ็นต์ต้องไม่เกิน 100');

  const { rows } = await query(
    `INSERT INTO promo_codes (code, description, discount_type, discount_value,
                              min_total, max_discount, max_uses, starts_at, ends_at, is_active)
     VALUES (UPPER($1),$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING *`,
    [d.code, d.description || null, d.discount_type, d.discount_value, d.min_total,
      d.max_discount ?? null, d.max_uses ?? null, d.starts_at ?? null, d.ends_at ?? null, d.is_active],
  ).catch((err) => {
    if (err.code === '23505') throw ApiError.conflict('มีโค้ดนี้อยู่แล้ว');
    throw err;
  });

  res.status(201).json({ promo: rows[0], message: 'สร้างโค้ดส่วนลดเรียบร้อยแล้ว' });
});

export const updatePromo = asyncHandler(async (req, res) => {
  const d = validate(req.body, promoSchema);

  const { rows } = await query(
    `UPDATE promo_codes
        SET code = UPPER($2), description = $3, discount_type = $4, discount_value = $5,
            min_total = $6, max_discount = $7, max_uses = $8, starts_at = $9, ends_at = $10, is_active = $11
      WHERE id = $1 RETURNING *`,
    [req.params.id, d.code, d.description || null, d.discount_type, d.discount_value, d.min_total,
      d.max_discount ?? null, d.max_uses ?? null, d.starts_at ?? null, d.ends_at ?? null, d.is_active],
  ).catch((err) => {
    if (err.code === '23505') throw ApiError.conflict('มีโค้ดนี้อยู่แล้ว');
    throw err;
  });

  if (!rows[0]) throw ApiError.notFound('ไม่พบโค้ดนี้');
  res.json({ promo: rows[0], message: 'บันทึกโค้ดส่วนลดเรียบร้อยแล้ว' });
});

export const deletePromo = asyncHandler(async (req, res) => {
  const { rowCount } = await query('DELETE FROM promo_codes WHERE id = $1', [req.params.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบโค้ดนี้');
  res.json({ message: 'ลบโค้ดส่วนลดเรียบร้อยแล้ว' });
});
