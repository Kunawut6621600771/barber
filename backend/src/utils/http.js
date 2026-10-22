/** ข้อผิดพลาดที่ตั้งใจส่งกลับให้ client (ไม่ใช่ bug) */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
  static badRequest(msg = 'ข้อมูลไม่ถูกต้อง', d) { return new ApiError(400, msg, d); }
  static unauthorized(msg = 'กรุณาเข้าสู่ระบบ')   { return new ApiError(401, msg); }
  static forbidden(msg = 'ไม่มีสิทธิ์เข้าถึง')     { return new ApiError(403, msg); }
  static notFound(msg = 'ไม่พบข้อมูล')            { return new ApiError(404, msg); }
  static conflict(msg = 'ข้อมูลขัดแย้ง')          { return new ApiError(409, msg); }
}

/** ห่อ async handler ให้ error ตกไปที่ error middleware โดยไม่ต้อง try/catch ทุกที่ */
export const asyncHandler = (fn) => (req, res, next) =>
  Promise.resolve(fn(req, res, next)).catch(next);
