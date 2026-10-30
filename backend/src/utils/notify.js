/**
 * ระบบแจ้งเตือน (Notification)
 *  - near_turn : ใกล้ถึงคิว
 *  - your_turn : ถึงคิวแล้ว
 *  - cancelled : คิวถูกยกเลิก
 *  - skipped   : คิวถูกข้าม
 *
 * บันทึกลงตาราง notifications (channel = in_app) และ push ผ่าน SSE ทันที
 * และถ้าลูกค้าผูกบัญชี LINE ไว้ จะส่งข้อความผ่าน LINE Official Account ด้วย (หลัง commit)
 */
import { broadcast } from './realtime.js';
import { onCommit } from '../db.js';
import { lineEnabled, pushMessage } from './line.js';
import { queueCard } from './line-flex.js';

const LINE_TONE = { near_turn: 'warn', your_turn: 'ok', called_again: 'warn', cancelled: 'danger', skipped: 'danger', done: 'ok' };

const TEMPLATES = {
  near_turn: (t) => ({
    title: 'ใกล้ถึงคิวของคุณแล้ว',
    message: `คิว ${t.ticket_no} เหลืออีก ${t.remaining ?? 0} คิว กรุณาเตรียมตัวที่หน้าร้าน`,
  }),
  your_turn: (t) => ({
    title: 'ถึงคิวของคุณแล้ว',
    message: `คิว ${t.ticket_no} เชิญที่เคาน์เตอร์${t.barber_name ? ` ช่าง ${t.barber_name}` : ''}`,
  }),
  called_again: (t) => ({
    title: 'เรียกคิวซ้ำ',
    message: `เรียกคิว ${t.ticket_no} อีกครั้ง กรุณาติดต่อพนักงานภายใน 5 นาที`,
  }),
  skipped: (t) => ({
    title: 'คิวของคุณถูกข้าม',
    message: `คิว ${t.ticket_no} ถูกข้ามเนื่องจากไม่มาตามเวลา ระบบเลื่อนคิวของคุณไปด้านหลัง`,
  }),
  cancelled: (t) => ({
    title: 'คิวของคุณถูกยกเลิก',
    message: `คิว ${t.ticket_no} ถูกยกเลิกแล้ว${t.reason ? ` (${t.reason})` : ''}`,
  }),
  done: (t) => ({
    title: 'ให้บริการเสร็จสิ้น',
    message: `คิว ${t.ticket_no} เสร็จสิ้นแล้ว ขอบคุณที่ใช้บริการ`,
  }),
};

/** ผู้ใช้เปิดรับแจ้งเตือนชนิดนี้ไหม */
const PREF_COLUMN = {
  near_turn: 'notify_near_turn',
  your_turn: 'notify_my_turn',
  called_again: 'notify_my_turn',
  cancelled: 'notify_cancel',
  skipped: 'notify_cancel',
};

/**
 * @param {import('pg').PoolClient} client  ใช้ client เดิมเพื่ออยู่ใน transaction เดียวกับการเปลี่ยนสถานะคิว
 */
export async function notifyTicket(client, { type, ticket, reason, remaining }) {
  const build = TEMPLATES[type];
  if (!build) return null;

  const payload = build({ ...ticket, reason, remaining });

  // ลูกค้า walk-in ที่ไม่มีบัญชี -> ไม่มีปลายทางแจ้งเตือนในระบบ แต่ยัง broadcast ขึ้นจอหน้าร้าน
  if (!ticket.customer_id) {
    broadcast('notification', { ...payload, type, ticket_no: ticket.ticket_no });
    return null;
  }

  const prefCol = PREF_COLUMN[type] || 'TRUE';
  const { rows: pref } = await client.query(
    `SELECT ${prefCol} AS enabled, line_user_id FROM users WHERE id = $1`, [ticket.customer_id],
  );
  if (pref[0] && pref[0].enabled === false) return null;
  const lineUserId = pref[0]?.line_user_id;

  const { rows } = await client.query(
    `INSERT INTO notifications (user_id, ticket_id, type, title, message, channel)
     VALUES ($1, $2, $3, $4, $5, 'in_app')
     ON CONFLICT DO NOTHING
     RETURNING *`,
    [ticket.customer_id, ticket.id, type, payload.title, payload.message],
  );

  const notification = rows[0] || null;
  if (notification) {
    broadcast('notification', {
      ...notification,
      ticket_no: ticket.ticket_no,
    }, ticket.customer_id);

    // ส่งต่อไปที่ LINE (ถ้าผูกบัญชีไว้) — ทำหลัง commit และไม่ให้ความผิดพลาดของ LINE กระทบคิว
    if (lineUserId && lineEnabled()) {
      const rows = [];
      if (ticket.service_name) rows.push(['บริการ', ticket.service_name]);
      if (type === 'near_turn') rows.push(['เหลืออีก', `${remaining ?? 0} คิว`]);
      if (ticket.barber_name) rows.push(['ช่าง', ticket.barber_name]);
      onCommit(client, () => pushMessage(lineUserId, queueCard({
        title: payload.title,
        message: payload.message,
        ticketNo: ticket.ticket_no,
        rows,
        tone: LINE_TONE[type] || 'brand',
      })));
    }
  }
  return notification;
}

/**
 * แจ้งเตือน "ใกล้ถึงคิว" ให้ลูกค้าที่อยู่ในลำดับต้น ๆ ตามค่า near_turn_threshold
 * เรียกทุกครั้งหลังคิวขยับ
 */
export async function notifyNearTurn(client, queueDate) {
  const { rows: settings } = await client.query(
    `SELECT value FROM shop_settings WHERE key = 'near_turn_threshold'`,
  );
  const threshold = Number(settings[0]?.value ?? 2);

  const { rows: tickets } = await client.query(
    `SELECT q.id, q.ticket_no, q.customer_id, q.position
       FROM queue_tickets q
      WHERE q.queue_date = $1
        AND q.status = 'waiting'
        AND q.customer_id IS NOT NULL
        AND q.position IS NOT NULL
        AND q.position <= $2
        AND NOT EXISTS (
              SELECT 1 FROM notifications n
               WHERE n.ticket_id = q.id AND n.type = 'near_turn')`,
    [queueDate, threshold],
  );

  for (const t of tickets) {
    await notifyTicket(client, { type: 'near_turn', ticket: t, remaining: Math.max((t.position ?? 1) - 1, 0) });
  }
  return tickets.length;
}
