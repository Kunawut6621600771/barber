/**
 * Module: สินค้าขายหน้าร้าน + สต็อก
 *
 *   GET    /api/products            รายการสินค้า (ค้นหา / กรองหมวด / เฉพาะที่เปิดขาย)
 *   GET    /api/products/categories หมวดสินค้าที่มีอยู่
 *   GET    /api/products/low-stock  สินค้าที่ใกล้หมด
 *   GET    /api/products/:id        รายละเอียด + ประวัติสต็อกล่าสุด
 *   POST   /api/products            เพิ่มสินค้า
 *   PUT    /api/products/:id        แก้ไขสินค้า
 *   DELETE /api/products/:id        ปิดการขาย (soft delete) หรือลบถ้ายังไม่เคยขาย
 *   POST   /api/products/:id/stock  รับสินค้าเข้า / ปรับยอด / ตัดของเสีย
 */
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';

/** บันทึกการเคลื่อนไหวสต็อกพร้อมอัปเดตยอดคงเหลือ — ต้องอยู่ใน transaction */
export async function moveStock(client, { productId, changeQty, reason, saleId = null, note = null, actorId = null }) {
  const { rows } = await client.query(
    'SELECT id, name, stock_qty, track_stock FROM products WHERE id = $1 FOR UPDATE',
    [productId],
  );
  const p = rows[0];
  if (!p) throw ApiError.notFound('ไม่พบสินค้านี้');
  if (!p.track_stock) return null;

  const balance = p.stock_qty + changeQty;
  if (balance < 0) {
    throw ApiError.conflict(`สินค้า "${p.name}" มีคงเหลือ ${p.stock_qty} ชิ้น ไม่พอตัดออก ${Math.abs(changeQty)} ชิ้น`);
  }

  await client.query('UPDATE products SET stock_qty = $2 WHERE id = $1', [p.id, balance]);
  await client.query(
    `INSERT INTO stock_movements (product_id, change_qty, balance_after, reason, sale_id, note, actor_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7)`,
    [p.id, changeQty, balance, reason, saleId, note, actorId],
  );
  return balance;
}

/* ------------------------------- อ่าน ------------------------------- */

export const listProducts = asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.active_only === 'true') where.push('is_active = TRUE');

  if (req.query.category) {
    params.push(req.query.category);
    where.push(`category = $${params.length}`);
  }
  if (req.query.q) {
    params.push(`%${String(req.query.q).trim()}%`);
    where.push(`(name ILIKE $${params.length} OR sku ILIKE $${params.length})`);
  }
  if (req.query.low_stock === 'true') {
    where.push('track_stock = TRUE AND stock_qty <= low_stock_level');
  }

  const { rows } = await query(
    `SELECT *, (track_stock AND stock_qty <= low_stock_level) AS is_low_stock
       FROM products
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY category, name`,
    params,
  );
  res.json({ data: rows });
});

export const listProductCategories = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT category AS name, COUNT(*)::int AS product_count
       FROM products WHERE is_active = TRUE
      GROUP BY category ORDER BY category`,
  );
  res.json({ data: rows });
});

export const lowStock = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT * FROM products
      WHERE is_active = TRUE AND track_stock = TRUE AND stock_qty <= low_stock_level
      ORDER BY stock_qty, name`,
  );
  res.json({ data: rows });
});

export const getProduct = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT * FROM products WHERE id = $1', [req.params.id]);
  if (!rows[0]) throw ApiError.notFound('ไม่พบสินค้านี้');

  const { rows: movements } = await query(
    `SELECT m.*, u.full_name AS actor_name
       FROM stock_movements m LEFT JOIN users u ON u.id = m.actor_id
      WHERE m.product_id = $1 ORDER BY m.created_at DESC LIMIT 50`,
    [req.params.id],
  );
  res.json({ product: rows[0], movements });
});

/* ------------------------------ เขียน ------------------------------- */

const productSchema = {
  sku: { type: 'string', max: 40, label: 'รหัสสินค้า' },
  name: { type: 'string', required: true, max: 150, label: 'ชื่อสินค้า' },
  category: { type: 'string', max: 60, default: 'ทั่วไป', label: 'หมวดหมู่' },
  description: { type: 'string', max: 500, label: 'รายละเอียด' },
  cost_price: { type: 'number', min: 0, default: 0, label: 'ราคาทุน' },
  price: { type: 'number', min: 0, required: true, label: 'ราคาขาย' },
  stock_qty: { type: 'int', min: 0, default: 0, label: 'จำนวนคงเหลือ' },
  low_stock_level: { type: 'int', min: 0, default: 5, label: 'จุดเตือนสต็อกต่ำ' },
  track_stock: { type: 'bool', default: true, label: 'ตัดสต็อก' },
  image_url: { type: 'string', max: 500, label: 'รูปสินค้า' },
  is_active: { type: 'bool', default: true, label: 'เปิดขาย' },
};

export const createProduct = asyncHandler(async (req, res) => {
  const d = validate(req.body, productSchema);

  const product = await withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO products (sku, name, category, description, cost_price, price,
                             stock_qty, low_stock_level, track_stock, image_url, is_active)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
      [d.sku || null, d.name, d.category, d.description || null, d.cost_price, d.price,
        d.stock_qty, d.low_stock_level, d.track_stock, d.image_url || null, d.is_active],
    ).catch((err) => {
      if (err.code === '23505') throw ApiError.conflict('รหัสสินค้า (SKU) นี้มีอยู่แล้ว');
      throw err;
    });

    if (d.stock_qty > 0 && d.track_stock) {
      await client.query(
        `INSERT INTO stock_movements (product_id, change_qty, balance_after, reason, note, actor_id)
         VALUES ($1,$2,$2,'restock','ยอดตั้งต้นตอนเพิ่มสินค้า',$3)`,
        [rows[0].id, d.stock_qty, req.user.id],
      );
    }
    return rows[0];
  });

  res.status(201).json({ product, message: 'เพิ่มสินค้าเรียบร้อยแล้ว' });
});

export const updateProduct = asyncHandler(async (req, res) => {
  const d = validate(req.body, productSchema);

  // stock_qty แก้ผ่าน /stock เท่านั้น เพื่อให้มีประวัติเสมอ
  const { rows } = await query(
    `UPDATE products
        SET sku = $2, name = $3, category = $4, description = $5, cost_price = $6,
            price = $7, low_stock_level = $8, track_stock = $9, image_url = $10, is_active = $11
      WHERE id = $1 RETURNING *`,
    [req.params.id, d.sku || null, d.name, d.category, d.description || null, d.cost_price,
      d.price, d.low_stock_level, d.track_stock, d.image_url || null, d.is_active],
  ).catch((err) => {
    if (err.code === '23505') throw ApiError.conflict('รหัสสินค้า (SKU) นี้มีอยู่แล้ว');
    throw err;
  });

  if (!rows[0]) throw ApiError.notFound('ไม่พบสินค้านี้');
  res.json({ product: rows[0], message: 'บันทึกสินค้าเรียบร้อยแล้ว' });
});

export const adjustStock = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    change_qty: { type: 'int', required: true, label: 'จำนวน' },
    reason: { type: 'enum', enum: ['restock', 'adjust', 'damage'], default: 'restock', label: 'เหตุผล' },
    note: { type: 'string', max: 300, label: 'หมายเหตุ' },
  });
  if (d.change_qty === 0) throw ApiError.badRequest('จำนวนต้องไม่เป็น 0');

  const balance = await withTransaction((client) => moveStock(client, {
    productId: req.params.id,
    changeQty: d.change_qty,
    reason: d.reason,
    note: d.note || null,
    actorId: req.user.id,
  }));

  if (balance === null) throw ApiError.badRequest('สินค้านี้ตั้งค่าไม่ให้ตัดสต็อก');
  res.json({ stock_qty: balance, message: `ปรับสต็อกแล้ว คงเหลือ ${balance} ชิ้น` });
});

export const deleteProduct = asyncHandler(async (req, res) => {
  const { rows: used } = await query('SELECT 1 FROM sale_items WHERE product_id = $1 LIMIT 1', [req.params.id]);

  if (used.length) {
    // เคยขายไปแล้ว ลบไม่ได้ (ใบเสร็จเก่าต้องอ้างอิงได้) -> ปิดการขายแทน
    const { rows } = await query(
      'UPDATE products SET is_active = FALSE WHERE id = $1 RETURNING id', [req.params.id],
    );
    if (!rows[0]) throw ApiError.notFound('ไม่พบสินค้านี้');
    return res.json({ message: 'สินค้านี้เคยมีการขายแล้ว ระบบปิดการขายให้แทนการลบ' });
  }

  const { rowCount } = await query('DELETE FROM products WHERE id = $1', [req.params.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบสินค้านี้');
  return res.json({ message: 'ลบสินค้าเรียบร้อยแล้ว' });
});
