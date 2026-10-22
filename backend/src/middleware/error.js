import { ApiError } from '../utils/http.js';
import { config } from '../config.js';

export function notFound(_req, _res, next) {
  next(ApiError.notFound('ไม่พบ endpoint ที่เรียก'));
}

// eslint-disable-next-line no-unused-vars
export function errorHandler(err, _req, res, _next) {
  // แปลง error ของ PostgreSQL ให้เป็นข้อความที่ผู้ใช้เข้าใจได้
  if (err.code === '23505') {
    const map = {
      users_email_key: 'อีเมลนี้ถูกใช้งานแล้ว',
      barbers_code_key: 'รหัสช่างนี้ถูกใช้งานแล้ว',
      uniq_active_ticket_per_customer: 'คุณมีคิวที่ยังไม่เสร็จสิ้นอยู่แล้ว',
      queue_ticket_unique_per_day: 'หมายเลขคิวซ้ำ กรุณาลองใหม่',
      service_categories_name_key: 'ชื่อประเภทบริการนี้มีอยู่แล้ว',
      uniq_payments_trans_ref: 'สลิปนี้ถูกใช้ชำระเงินไปแล้ว',
      uniq_users_line_user_id: 'บัญชี LINE นี้เชื่อมกับผู้ใช้อื่นอยู่แล้ว',
    };
    err = ApiError.conflict(map[err.constraint] || 'ข้อมูลซ้ำกับที่มีอยู่แล้ว');
  } else if (err.code === '23503') {
    err = ApiError.conflict('ไม่สามารถดำเนินการได้ เนื่องจากมีข้อมูลอื่นอ้างอิงอยู่');
  } else if (err.code === '23514') {
    err = ApiError.badRequest('ข้อมูลไม่ผ่านเงื่อนไขของระบบ');
  } else if (err.code === '3D000' || err.code === 'ECONNREFUSED') {
    err = new ApiError(503, 'เชื่อมต่อฐานข้อมูลไม่ได้ กรุณาตรวจสอบ PostgreSQL');
  }

  const status = err.status || 500;
  if (status >= 500) console.error('[error]', err);

  res.status(status).json({
    error: err.message || 'เกิดข้อผิดพลาดภายในระบบ',
    ...(err.details ? { details: err.details } : {}),
    ...(config.env !== 'production' && status >= 500 ? { stack: err.stack } : {}),
  });
}
