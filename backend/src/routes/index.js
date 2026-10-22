import { Router } from 'express';
import { authenticate, requireRole, requireStaff } from '../middleware/auth.js';
import * as auth from '../controllers/auth.controller.js';
import * as users from '../controllers/users.controller.js';
import * as barbers from '../controllers/barbers.controller.js';
import * as services from '../controllers/services.controller.js';
import * as queue from '../controllers/queue.controller.js';
import * as dashboard from '../controllers/dashboard.controller.js';
import * as notifications from '../controllers/notifications.controller.js';
import * as reports from '../controllers/reports.controller.js';
import * as payments from '../controllers/payments.controller.js';
import * as line from '../controllers/line.controller.js';

const router = Router();
const admin = requireRole('admin');
const adminOrStaff = requireRole('admin', 'staff');

/* ------------------------- Authentication ------------------------- */
router.post('/auth/register', auth.register);
router.post('/auth/login', auth.login);
router.post('/auth/refresh', auth.refresh);
router.post('/auth/forgot-password', auth.forgotPassword);
router.post('/auth/reset-password', auth.resetPassword);          // Create / Reset Password
router.post('/auth/logout', auth.logout);
router.post('/auth/line', line.loginWithLine);
router.get('/auth/me', authenticate, auth.me);
router.post('/auth/change-password', authenticate, auth.changePassword);

/* --------------------- คิว: endpoint สาธารณะ ---------------------- */
router.get('/queue/current', queue.currentQueue);                  // จอแสดงคิวหน้าร้าน
router.get('/queue/shop-qr', queue.shopQr);                        // QR หน้าร้าน
router.get('/queue/track/:token', queue.trackTicket);              // ติดตามคิวผ่าน QR
router.get('/notifications/stream', notifications.stream);         // SSE (token ผ่าน query)
router.get('/line/config', line.lineConfig);                        // LIFF ID / ลิงก์เพิ่มเพื่อน
router.get('/services/public', (req, res, next) => {               // เลือกบริการก่อนล็อกอิน
  req.query.active_only = 'true';
  services.listServices(req, res, next);
});

/* ------------- ตั้งแต่บรรทัดนี้ต้องเข้าสู่ระบบก่อน --------------- */
router.use(authenticate);

/* -------------------------- Profile ------------------------------- */
router.put('/users/me', users.updateProfile);

/* ------------------------ Notification ---------------------------- */
router.get('/notifications', notifications.listNotifications);
router.patch('/notifications/read-all', notifications.markAllRead);
router.patch('/notifications/:id/read', notifications.markRead);
router.delete('/notifications/:id', notifications.removeNotification);

/* ------------------------ LINE ------------------------------------ */
router.get('/line/me', line.myLine);
router.post('/line/link', line.linkLine);
router.delete('/line/link', line.unlinkLine);

/* ---------------------- Payment (QR PromptPay) -------------------- */
router.get('/payments/config', payments.paymentConfig);
router.get('/payments/current', payments.currentPayment);
router.get('/payments', requireStaff, payments.listPayments);
router.post('/payments', payments.createPayment);
router.get('/payments/:id', payments.getPayment);
router.post('/payments/:id/slip', payments.submitSlip);
router.post('/payments/:id/cancel', payments.cancelPayment);
router.post('/payments/:id/approve', adminOrStaff, payments.approvePayment);

/* ------------------------- Queue ---------------------------------- */
router.get('/queue/my', queue.myQueue);
router.post('/queue', queue.takeTicket);                           // รับบัตรคิว
router.post('/queue/:id/cancel', queue.cancelTicket);              // ลูกค้ายกเลิกคิวของตัวเองได้

router.get('/queue', requireStaff, queue.listQueue);
router.get('/queue/:id/events', requireStaff, queue.ticketEvents);
router.post('/queue/call', requireStaff, queue.callNext);          // เรียกคิวถัดไป
router.post('/queue/reorder', requireStaff, queue.reorderQueue);   // จัดลำดับคิวอัตโนมัติ
router.post('/queue/:id/call', requireStaff, queue.callTicket);
router.post('/queue/:id/recall', requireStaff, queue.recallTicket);// เรียกคิวซ้ำ
router.post('/queue/:id/skip', requireStaff, queue.skipTicket);    // ข้ามคิว
router.post('/queue/:id/start', requireStaff, queue.startService);
router.post('/queue/:id/done', requireStaff, queue.finishService);

/* ------------------------- Services ------------------------------- */
router.get('/services', services.listServices);
router.get('/services/categories', services.listCategories);
router.get('/services/:id', services.getService);
router.post('/services', adminOrStaff, services.createService);
router.put('/services/:id', adminOrStaff, services.updateService);
router.delete('/services/:id', admin, services.deleteService);
router.post('/services/categories', adminOrStaff, services.createCategory);
router.put('/services/categories/:id', adminOrStaff, services.updateCategory);
router.delete('/services/categories/:id', admin, services.deleteCategory);

/* -------------------------- Barbers ------------------------------- */
router.get('/barbers', barbers.listBarbers);
router.patch('/barbers/:id/status', requireStaff, barbers.updateBarberStatus);
router.put('/barbers/:id', adminOrStaff, barbers.updateBarber);

/* ------------------------- Dashboard ------------------------------ */
router.get('/dashboard/summary', requireStaff, dashboard.summary);
router.get('/dashboard/trend', requireStaff, dashboard.trend);

/* --------------------------- Reports ------------------------------ */
router.get('/reports/customers', requireStaff, reports.customersReport);
router.get('/reports/wait-time', requireStaff, reports.waitTimeReport);
router.get('/reports/barbers', requireStaff, reports.barbersReport);
router.get('/reports/export', requireStaff, reports.exportCsv);

/* ----------------------- User Management -------------------------- */
router.get('/users', adminOrStaff, users.listUsers);
router.get('/users/:id', adminOrStaff, users.getUser);
router.post('/users', adminOrStaff, users.createUser);
router.put('/users/:id', adminOrStaff, users.updateUser);
router.delete('/users/:id', admin, users.deleteUser);
router.post('/users/:id/reset-password', admin, users.adminSetPassword);

export default router;
