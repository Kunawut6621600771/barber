import jwt from 'jsonwebtoken';
import { config } from '../config.js';
import { query } from '../db.js';
import { ApiError } from '../utils/http.js';

/** ตรวจ JWT จาก header Authorization: Bearer <token> */
export async function authenticate(req, _res, next) {
  try {
    const header = req.headers.authorization || '';
    const token = header.startsWith('Bearer ') ? header.slice(7) : null;
    if (!token) throw ApiError.unauthorized();

    let payload;
    try {
      payload = jwt.verify(token, config.jwt.secret);
    } catch {
      throw ApiError.unauthorized('เซสชันหมดอายุ กรุณาเข้าสู่ระบบใหม่');
    }

    const { rows } = await query(
      `SELECT u.id, u.full_name, u.email, u.phone, u.role, u.status, u.avatar_url,
              b.id AS barber_id
         FROM users u
         LEFT JOIN barbers b ON b.user_id = u.id
        WHERE u.id = $1`,
      [payload.sub],
    );
    const user = rows[0];
    if (!user) throw ApiError.unauthorized('ไม่พบบัญชีผู้ใช้');
    if (user.status !== 'active') throw ApiError.forbidden('บัญชีนี้ถูกระงับการใช้งาน');

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
}

/** จำกัดสิทธิ์ตาม role  เช่น requireRole('admin', 'staff') */
export const requireRole = (...roles) => (req, _res, next) => {
  if (!req.user) return next(ApiError.unauthorized());
  if (!roles.includes(req.user.role)) return next(ApiError.forbidden());
  next();
};

/** พนักงานหน้าร้าน = admin | staff | barber */
export const requireStaff = requireRole('admin', 'staff', 'barber');
