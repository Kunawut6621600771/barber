/**
 * Module: Service Management
 *  จัดการประเภทบริการ / เพิ่ม / แก้ไข / ลบบริการ / กำหนดระยะเวลา / กำหนดราคา
 */
import { query } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';

/* --------------------------- ประเภทบริการ --------------------------- */

/** GET /api/services/categories */
export const listCategories = asyncHandler(async (_req, res) => {
  const { rows } = await query(
    `SELECT c.*, COUNT(s.id) FILTER (WHERE s.is_active) AS service_count
       FROM service_categories c
       LEFT JOIN services s ON s.category_id = c.id
      GROUP BY c.id ORDER BY c.sort_order, c.name`,
  );
  res.json({ data: rows });
});

/** POST /api/services/categories */
export const createCategory = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    name: { type: 'string', required: true, min: 2, max: 100, label: 'ชื่อประเภทบริการ' },
    description: { type: 'string', max: 500, label: 'คำอธิบาย' },
    sort_order: { type: 'int', min: 0, default: 0, label: 'ลำดับ' },
  });
  const { rows } = await query(
    `INSERT INTO service_categories (name, description, sort_order) VALUES ($1,$2,$3) RETURNING *`,
    [data.name, data.description ?? null, data.sort_order],
  );
  res.status(201).json({ category: rows[0] });
});

/** PUT /api/services/categories/:id */
export const updateCategory = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    name: { type: 'string', min: 2, max: 100, label: 'ชื่อประเภทบริการ' },
    description: { type: 'string', max: 500, label: 'คำอธิบาย' },
    sort_order: { type: 'int', min: 0, label: 'ลำดับ' },
    is_active: { type: 'bool' },
  });
  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('ไม่มีข้อมูลที่ต้องการแก้ไข');

  params.push(req.params.id);
  const { rows } = await query(
    `UPDATE service_categories SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params,
  );
  if (!rows[0]) throw ApiError.notFound('ไม่พบประเภทบริการนี้');
  res.json({ category: rows[0] });
});

/** DELETE /api/services/categories/:id */
export const deleteCategory = asyncHandler(async (req, res) => {
  const { rows } = await query('SELECT COUNT(*)::int AS n FROM services WHERE category_id = $1', [req.params.id]);
  if (rows[0].n > 0) throw ApiError.conflict(`ยังมีบริการ ${rows[0].n} รายการอยู่ในประเภทนี้ กรุณาย้ายหรือลบก่อน`);

  const { rowCount } = await query('DELETE FROM service_categories WHERE id = $1', [req.params.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบประเภทบริการนี้');
  res.json({ message: 'ลบประเภทบริการเรียบร้อยแล้ว' });
});

/* ----------------------------- บริการ ------------------------------ */

/** GET /api/services?category_id=&search=&active_only= */
export const listServices = asyncHandler(async (req, res) => {
  const params = [];
  const where = [];

  if (req.query.category_id) {
    params.push(req.query.category_id);
    where.push(`s.category_id = $${params.length}`);
  }
  if (req.query.search) {
    params.push(`%${req.query.search.trim()}%`);
    where.push(`s.name ILIKE $${params.length}`);
  }
  if (req.query.active_only === 'true') where.push('s.is_active = TRUE');

  const { rows } = await query(
    `SELECT s.*, c.name AS category_name,
            (SELECT COUNT(*) FROM queue_tickets q
              WHERE q.service_id = s.id AND q.status = 'done') AS booked_count
       FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
       ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
      ORDER BY c.sort_order NULLS LAST, s.name`,
    params,
  );
  res.json({ data: rows });
});

/** GET /api/services/:id */
export const getService = asyncHandler(async (req, res) => {
  const { rows } = await query(
    `SELECT s.*, c.name AS category_name
       FROM services s LEFT JOIN service_categories c ON c.id = s.category_id
      WHERE s.id = $1`,
    [req.params.id],
  );
  if (!rows[0]) throw ApiError.notFound('ไม่พบบริการนี้');
  res.json({ service: rows[0] });
});

/** POST /api/services — เพิ่มบริการ */
export const createService = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    category_id: { type: 'int', label: 'ประเภทบริการ' },
    name: { type: 'string', required: true, min: 2, max: 120, label: 'ชื่อบริการ' },
    description: { type: 'string', max: 1000, label: 'รายละเอียด' },
    duration_min: { type: 'int', required: true, min: 1, max: 600, label: 'ระยะเวลา (นาที)' },
    price: { type: 'number', required: true, min: 0, label: 'ราคา' },
    image_url: { type: 'string', max: 500, label: 'รูปภาพ' },
    is_active: { type: 'bool', default: true },
  });

  const { rows } = await query(
    `INSERT INTO services (category_id, name, description, duration_min, price, image_url, is_active)
     VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [data.category_id ?? null, data.name, data.description ?? null, data.duration_min,
      data.price, data.image_url ?? null, data.is_active],
  );
  res.status(201).json({ service: rows[0] });
});

/** PUT /api/services/:id — แก้ไขบริการ / กำหนดระยะเวลา / กำหนดราคา */
export const updateService = asyncHandler(async (req, res) => {
  const data = validate(req.body, {
    category_id: { type: 'int', label: 'ประเภทบริการ' },
    name: { type: 'string', min: 2, max: 120, label: 'ชื่อบริการ' },
    description: { type: 'string', max: 1000, label: 'รายละเอียด' },
    duration_min: { type: 'int', min: 1, max: 600, label: 'ระยะเวลา (นาที)' },
    price: { type: 'number', min: 0, label: 'ราคา' },
    image_url: { type: 'string', max: 500, label: 'รูปภาพ' },
    is_active: { type: 'bool' },
  });

  const sets = [];
  const params = [];
  for (const [k, v] of Object.entries(data)) {
    params.push(v);
    sets.push(`${k} = $${params.length}`);
  }
  if (!sets.length) throw ApiError.badRequest('ไม่มีข้อมูลที่ต้องการแก้ไข');

  params.push(req.params.id);
  const { rows } = await query(`UPDATE services SET ${sets.join(', ')} WHERE id = $${params.length} RETURNING *`, params);
  if (!rows[0]) throw ApiError.notFound('ไม่พบบริการนี้');
  res.json({ service: rows[0] });
});

/** DELETE /api/services/:id — ลบบริการ (ถ้าเคยถูกใช้แล้วจะปิดการใช้งานแทน) */
export const deleteService = asyncHandler(async (req, res) => {
  const { rows: used } = await query('SELECT COUNT(*)::int AS n FROM queue_tickets WHERE service_id = $1', [req.params.id]);

  if (used[0].n > 0) {
    const { rows } = await query('UPDATE services SET is_active = FALSE WHERE id = $1 RETURNING *', [req.params.id]);
    if (!rows[0]) throw ApiError.notFound('ไม่พบบริการนี้');
    return res.json({
      message: `บริการนี้เคยถูกใช้งาน ${used[0].n} ครั้ง ระบบจึงปิดการใช้งานแทนการลบ เพื่อรักษาประวัติคิว`,
      service: rows[0],
    });
  }

  const { rowCount } = await query('DELETE FROM services WHERE id = $1', [req.params.id]);
  if (!rowCount) throw ApiError.notFound('ไม่พบบริการนี้');
  res.json({ message: 'ลบบริการเรียบร้อยแล้ว' });
});
