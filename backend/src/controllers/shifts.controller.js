/**
 * Module: กะเงินสด (เปิด/ปิดลิ้นชัก)
 *
 *   เปิดกะตอนเริ่มวัน บันทึกเงินทอนตั้งต้น ปิดกะตอนเลิกงานแล้วนับเงินจริง
 *   ระบบเทียบกับยอดที่ควรมี แล้วบอกว่าเงินขาดหรือเกินเท่าไร
 *
 *   GET  /api/shifts            ประวัติกะ
 *   GET  /api/shifts/current    กะที่เปิดอยู่ + ยอดสดตอนนี้
 *   GET  /api/shifts/:id        สรุปกะ + บิลในกะ
 *   POST /api/shifts/open       เปิดกะ
 *   POST /api/shifts/close      ปิดกะ (นับเงิน)
 *   POST /api/shifts/cash       นำเงินเข้า / เบิกเงินออกระหว่างกะ
 */
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';

const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

/** เงินสดที่ควรมีในลิ้นชัก = เงินทอนตั้งต้น + รับเงินสด - เงินทอน + เงินเข้า - เงินออก - คืนเงินสด */
async function expectedCash(client, shift) {
  const run = client ? client.query.bind(client) : query;

  const { rows } = await run(
    `SELECT
       COALESCE((SELECT SUM(sp.amount) FROM sale_payments sp
                   JOIN sales s ON s.id = sp.sale_id
                  WHERE s.shift_id = $1 AND sp.method = 'cash'
                    AND s.status IN ('paid','partial_refund','refunded')), 0) AS cash_in_sales,
       COALESCE((SELECT SUM(s.change_amount) FROM sales s
                  WHERE s.shift_id = $1
                    AND s.status IN ('paid','partial_refund','refunded')), 0)  AS change_given,
       COALESCE((SELECT SUM(r.amount) FROM sale_refunds r
                   JOIN sales s ON s.id = r.sale_id
                  WHERE COALESCE(r.shift_id, s.shift_id) = $1 AND r.method = 'cash'), 0) AS cash_refunds`,
    [shift.id],
  );
  const r = rows[0];

  return round2(
    Number(shift.opening_float)
    + Number(r.cash_in_sales)
    - Number(r.change_given)
    + Number(shift.cash_in)
    - Number(shift.cash_out)
    - Number(r.cash_refunds),
  );
}

export const listShifts = asyncHandler(async (req, res) => {
  const limit = Math.min(Math.max(Number.parseInt(req.query.limit, 10) || 30, 1), 100);
  const { rows } = await query(
    `SELECT * FROM v_shift_summary ORDER BY opened_at DESC LIMIT ${limit}`,
  );
  res.json({ data: rows });
});

export const currentShift = asyncHandler(async (_req, res) => {
  const { rows } = await query(`SELECT * FROM v_shift_summary WHERE status = 'open' LIMIT 1`);
  const shift = rows[0] || null;
  if (!shift) return res.json({ shift: null });

  return res.json({ shift: { ...shift, expected_cash: await expectedCash(null, shift) } });
});

export const getShift = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM v_shift_summary WHERE id = $1', [req.params.id]);
  const shift = rows[0];
  if (!shift) throw ApiError.notFound('ไม่พบกะนี้');

  const [sales, movements] = await Promise.all([
    query(
      `SELECT * FROM v_sale_detail WHERE shift_id = $1 ORDER BY created_at DESC`, [req.params.id],
    ),
    query(
      `SELECT m.*, u.full_name AS actor_name
         FROM cash_movements m LEFT JOIN users u ON u.id = m.actor_id
        WHERE m.shift_id = $1 ORDER BY m.created_at`,
      [req.params.id],
    ),
  ]);

  res.json({
    shift: { ...shift, expected_cash: shift.expected_cash ?? await expectedCash(null, shift) },
    sales: sales.rows,
    movements: movements.rows,
  });
});

export const openShift = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    opening_float: { type: 'number', min: 0, default: 0, label: 'เงินทอนตั้งต้น' },
    note: { type: 'string', max: 300, label: 'หมายเหตุ' },
  });

  const shift = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO cash_shifts (opened_by, opening_float, note) VALUES ($1,$2,$3) RETURNING id`,
      [req.user.id, d.opening_float, d.note || null],
    ).catch((err) => {
      if (err.code === '23505') throw ApiError.conflict('มีกะที่เปิดค้างอยู่ กรุณาปิดกะเดิมก่อน');
      throw err;
    });

    // บิลที่เปิดค้างไว้ก่อนเปิดกะ ให้นับเข้ากะนี้
    await client.query(
      `UPDATE sales SET shift_id = $1 WHERE shift_id IS NULL AND status = 'open'`, [rows[0].id],
    );

    const { rows: full } = await client.query('SELECT * FROM v_shift_summary WHERE id = $1', [rows[0].id]);
    return full[0];
  });

  res.status(201).json({ shift, message: 'เปิดกะเรียบร้อยแล้ว' });
});

export const closeShift = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    counted_cash: { type: 'number', min: 0, required: true, label: 'เงินสดที่นับได้' },
    note: { type: 'string', max: 300, label: 'หมายเหตุ' },
  });

  const shift = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `SELECT * FROM cash_shifts WHERE status = 'open' FOR UPDATE`,
    );
    const open = rows[0];
    if (!open) throw ApiError.notFound('ไม่มีกะที่เปิดอยู่');

    const { rows: stillOpen } = await client.query(
      `SELECT COUNT(*)::int AS n FROM sales WHERE shift_id = $1 AND status = 'open'`, [open.id],
    );
    if (stillOpen[0].n > 0) {
      throw ApiError.conflict(`ยังมีบิลค้างอยู่ ${stillOpen[0].n} ใบ กรุณาปิดหรือยกเลิกบิลก่อนปิดกะ`);
    }

    const expected = await expectedCash(client, open);

    await client.query(
      `UPDATE cash_shifts
          SET status = 'closed', closed_by = $2, closed_at = NOW(),
              counted_cash = $3, expected_cash = $4, difference = $5,
              note = COALESCE(NULLIF($6,''), note)
        WHERE id = $1`,
      [open.id, req.user.id, d.counted_cash, expected, round2(d.counted_cash - expected), d.note || ''],
    );

    const { rows: full } = await client.query('SELECT * FROM v_shift_summary WHERE id = $1', [open.id]);
    return full[0];
  });

  const diff = Number(shift.difference);
  const label = diff === 0 ? 'ยอดตรงพอดี' : diff > 0 ? `เงินเกิน ${diff.toFixed(2)} บาท` : `เงินขาด ${Math.abs(diff).toFixed(2)} บาท`;
  res.json({ shift, message: `ปิดกะเรียบร้อย · ${label}` });
});

export const cashMovement = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    direction: { type: 'enum', enum: ['in', 'out'], required: true, label: 'ทิศทาง' },
    amount: { type: 'number', min: 0, required: true, label: 'จำนวนเงิน' },
    reason: { type: 'string', required: true, max: 300, label: 'เหตุผล' },
  });
  if (d.amount <= 0) throw ApiError.badRequest('จำนวนเงินต้องมากกว่า 0');

  const shift = await withTransaction(async (client) => {
    const { rows } = await client.query(`SELECT * FROM cash_shifts WHERE status = 'open' FOR UPDATE`);
    const open = rows[0];
    if (!open) throw ApiError.badRequest('ต้องเปิดกะก่อนจึงจะบันทึกเงินเข้า-ออกได้');

    await client.query(
      `INSERT INTO cash_movements (shift_id, direction, amount, reason, actor_id) VALUES ($1,$2,$3,$4,$5)`,
      [open.id, d.direction, d.amount, d.reason, req.user.id],
    );
    await client.query(
      `UPDATE cash_shifts
          SET cash_in  = cash_in  + CASE WHEN $2 = 'in'  THEN $3::numeric ELSE 0 END,
              cash_out = cash_out + CASE WHEN $2 = 'out' THEN $3::numeric ELSE 0 END
        WHERE id = $1`,
      [open.id, d.direction, d.amount],
    );

    const { rows: full } = await client.query('SELECT * FROM v_shift_summary WHERE id = $1', [open.id]);
    return full[0];
  });

  res.json({
    shift: { ...shift, expected_cash: await expectedCash(null, shift) },
    message: d.direction === 'in' ? 'บันทึกเงินเข้าลิ้นชักแล้ว' : 'บันทึกการเบิกเงินออกแล้ว',
  });
});
