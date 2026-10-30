/**
 * สมองของ LINE Bot — แปลงข้อความลูกค้าเป็น "ความตั้งใจ" แล้วตอบกลับ
 *
 * ตอบได้เอง 24 ชม. เรื่อง: คิว ราคา เวลาเปิด-ปิด ที่ตั้ง ช่าง โปรโมชัน
 * แต้มสะสม การจอง วิธีชำระเงิน และคำถามที่พบบ่อย
 * เรื่องที่ตอบไม่ได้ จะบอกให้ลูกค้าโทรหาร้านหรือพิมพ์ "แอดมิน" ไว้ให้พนักงานตามอ่าน
 */
import { config } from '../config.js';
import { query, shopToday } from '../db.js';
import { replyMessage, appUrl, getProfile } from './line.js';
import { LINK_RE, redeemLinkCode } from './line-link.js';
import { publicShopInfo, loyaltyConfig } from './settings.js';
import {
  card, serviceCarousel, shopInfoCard, pointsCard, barbersCard, promosCard, paymentCard, quickReply,
} from './line-flex.js';

const baht = (n) => `฿${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

/* ------------------------------------------------------------------ */
/*  ตารางความตั้งใจ (intent) — เรียงจากเจาะจงไปกว้าง                    */
/* ------------------------------------------------------------------ */
const INTENTS = [
  { name: 'my_queue', re: /คิวของฉัน|คิวฉัน|คิวผม|คิวหนู|ถึงคิวยัง|เหลือกี่คิว|สถานะคิว|my ?queue|my ?ticket/i },
  { name: 'shop_queue', re: /คิวตอนนี้|คิวหน้าร้าน|ตอนนี้คิวถึงไหน|คิวถึงไหน|คนเยอะ|รอนานไหม|ว่างไหม|คิวยาว/i },
  { name: 'cancel_queue', re: /ยกเลิกคิว|ไม่เอาคิว|ขอยกเลิก|cancel/i },
  { name: 'book', re: /จองคิว|จองล่วงหน้า|นัดหมาย|จองวัน|ขอจอง|book|reserve|appointment/i },
  { name: 'take_queue', re: /รับคิว|รับบัตร|เอาคิว|ขอคิว|กดคิว/i },
  { name: 'price', re: /ราคา|เท่าไห?ร่|กี่บาท|ค่าตัด|ค่าบริการ|เมนู|บริการอะไร|มีอะไรบ้าง|price|menu/i },
  { name: 'hours', re: /เปิด|ปิด|กี่โมง|เวลา|วันไหน|หยุดวัน|open|close|hour/i },
  { name: 'location', re: /ที่ตั้ง|ที่อยู่|แผนที่|ไปยังไง|อยู่ไหน|พิกัด|map|location|address/i },
  { name: 'contact', re: /เบอร์|โทร|ติดต่อ|phone|call/i },
  { name: 'barbers', re: /ช่าง|ใครตัด|สไตลิสต์|barber|stylist/i },
  { name: 'points', re: /แต้ม|คะแนน|สะสม|สมาชิก|ระดับ|point|member|loyalty/i },
  { name: 'promo', re: /โปร|ส่วนลด|โค้ด|ลดราคา|promotion|promo|discount|coupon/i },
  { name: 'payment', re: /จ่าย|ชำระ|โอน|พร้อมเพย์|promptpay|บัตรเครดิต|เงินสด|สลิป|pay/i },
  { name: 'history', re: /ประวัติ|เคยตัด|ที่ผ่านมา|history/i },
  { name: 'admin', re: /แอดมิน|พนักงาน|คุยกับคน|เจ้าหน้าที่|ร้องเรียน|admin|staff|human/i },
  { name: 'thanks', re: /ขอบคุณ|ขอบใจ|thank|thx/i },
  { name: 'greet', re: /^(สวัสดี|หวัดดี|ดีครับ|ดีค่ะ|hello|hi|hey)/i },
  { name: 'help', re: /ช่วยเหลือ|เมนู|ทำอะไรได้|help|menu|start/i },
];

export const detectIntent = (raw) => {
  const text = String(raw || '').trim();
  if (!text) return 'help';
  return INTENTS.find((i) => i.re.test(text))?.name ?? 'fallback';
};

/* ------------------------------------------------------------------ */
/*  ตัวช่วย                                                            */
/* ------------------------------------------------------------------ */

async function userOf(lineUserId) {
  if (!lineUserId) return null;
  const { rows } = await query(
    `SELECT id, full_name, loyalty_points, member_tier, total_spent
       FROM users WHERE line_user_id = $1`,
    [lineUserId],
  );
  return rows[0] || null;
}

const notLinkedCard = (shopName) => card({
  shopName,
  title: 'ยังไม่ได้เชื่อมบัญชี',
  message: 'เปิดแอปของร้านแล้วเข้าสู่ระบบด้วย LINE สักครั้ง จากนั้นเราจะแจ้งเตือนคิวและดูแต้มสะสมให้คุณได้ที่นี่เลย',
  buttons: [{ label: 'เชื่อมบัญชี / รับบัตรคิว', path: '/app/take-queue' }],
});

/** บันทึกบทสนทนาไว้ให้แอดมินตามอ่าน (ไม่ให้ล้มถ้าเขียนไม่ได้) */
async function logMessage({ lineUserId, userId, direction, intent, text }) {
  try {
    await query(
      `INSERT INTO line_messages (line_user_id, user_id, direction, intent, text)
       VALUES ($1,$2,$3,$4,$5)`,
      [lineUserId ?? null, userId ?? null, direction, intent ?? null, (text ?? '').slice(0, 2000)],
    );
  } catch (err) {
    console.error('[line log]', err.message);
  }
}

/* ------------------------------------------------------------------ */
/*  คำตอบของแต่ละความตั้งใจ                                             */
/* ------------------------------------------------------------------ */

async function myQueueReply(lineUserId, shop) {
  const user = await userOf(lineUserId);
  if (!user) return notLinkedCard(shop.shop_name);

  const { rows } = await query(
    `SELECT * FROM v_queue_board
      WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called','serving')
      ORDER BY seq LIMIT 1`,
    [user.id, shopToday()],
  );
  const t = rows[0];

  if (!t) {
    // ไม่มีคิววันนี้ — มีจองล่วงหน้าไว้หรือเปล่า
    const { rows: appts } = await query(
      `SELECT a.appoint_date, TO_CHAR(a.appoint_time,'HH24:MI') AS t, s.name
         FROM appointments a JOIN services s ON s.id = a.service_id
        WHERE a.customer_id = $1 AND a.status IN ('pending','confirmed')
          AND a.appoint_date >= $2
        ORDER BY a.appoint_date, a.appoint_time LIMIT 1`,
      [user.id, shopToday()],
    );

    if (appts[0]) {
      return card({
        shopName: shop.shop_name,
        title: 'คุณมีนัดหมายล่วงหน้า',
        message: 'วันนี้ยังไม่มีบัตรคิว แต่คุณจองไว้แล้วตามรายละเอียดด้านล่าง',
        rows: [['วันที่', appts[0].appoint_date], ['เวลา', `${appts[0].t} น.`], ['บริการ', appts[0].name]],
        buttons: [{ label: 'ดูการจองของฉัน', path: '/app/my-queue' }, { label: 'รับบัตรคิวเลย', path: '/app/take-queue' }],
      });
    }

    return card({
      shopName: shop.shop_name,
      title: 'วันนี้คุณยังไม่มีคิว',
      message: 'กดปุ่มด้านล่างเพื่อเลือกบริการและรับบัตรคิวได้ทันที หรือจะจองล่วงหน้าไว้ก่อนก็ได้',
      buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }, { label: 'จองล่วงหน้า', path: '/app/book' }],
    });
  }

  const [{ rows: ahead }, { rows: est }] = await Promise.all([
    query(
      `SELECT COUNT(*)::int AS n FROM queue_tickets
        WHERE queue_date = $1 AND status = 'waiting' AND position < $2`,
      [t.queue_date, t.position ?? 0],
    ),
    query('SELECT estimate_wait_minutes($1,$2) AS mins', [t.queue_date, t.position ?? 1]),
  ]);

  const statusText = {
    waiting: 'กำลังรอคิว',
    called: 'ถึงคิวคุณแล้ว เชิญที่เคาน์เตอร์',
    serving: 'กำลังให้บริการอยู่',
  }[t.status];

  return card({
    shopName: shop.shop_name,
    title: statusText,
    ticketNo: t.ticket_no,
    tone: t.status === 'called' ? 'danger' : t.status === 'serving' ? 'ok' : 'brand',
    rows: [
      ['บริการ', t.service_name],
      ['ราคา', baht(t.price)],
      ...(t.status === 'waiting'
        ? [['เหลืออีก', `${ahead[0].n} คิว`, { bold: true }], ['รอประมาณ', `${est[0].mins} นาที`]]
        : []),
      ...(t.barber_name ? [['ช่าง', t.barber_name]] : []),
    ],
    buttons: [{ label: 'เปิดดูคิวของฉัน', path: '/app/my-queue' }],
  });
}

async function shopQueueReply(shop) {
  const { rows } = await query(
    `SELECT COUNT(*) FILTER (WHERE status='waiting')::int AS waiting,
            COUNT(*) FILTER (WHERE status='done')::int    AS done,
            (SELECT ticket_no FROM queue_tickets WHERE queue_date=$1 AND status='serving'
              ORDER BY started_at DESC LIMIT 1) AS serving,
            (SELECT ticket_no FROM queue_tickets WHERE queue_date=$1 AND status='called'
              ORDER BY called_at DESC LIMIT 1)  AS called
       FROM queue_tickets WHERE queue_date = $1`,
    [shopToday()],
  );
  const s = rows[0];

  const { rows: est } = await query('SELECT estimate_wait_minutes($1,$2) AS mins', [shopToday(), s.waiting + 1]);

  return card({
    shopName: shop.shop_name,
    title: 'สถานะคิวหน้าร้านตอนนี้',
    message: s.waiting === 0
      ? 'ตอนนี้ไม่มีคิวรอเลย มาได้ทันทีไม่ต้องรอครับ'
      : `ถ้ารับบัตรคิวตอนนี้ จะรอประมาณ ${est[0].mins} นาที`,
    rows: [
      ['กำลังเรียก', s.called || '—'],
      ['กำลังให้บริการ', s.serving || '—'],
      ['คิวที่รออยู่', `${s.waiting} คิว`, { bold: true }],
      ['เสร็จแล้ววันนี้', `${s.done} คิว`],
    ],
    buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }, { label: 'ดูจอคิวหน้าร้าน', path: '/board' }],
  });
}

async function priceReply(shop) {
  const { rows } = await query(
    `SELECT s.name, s.price, s.duration_min
       FROM services s WHERE s.is_active = TRUE
      ORDER BY s.price`,
  );
  if (!rows.length) {
    return card({ shopName: shop.shop_name, title: 'ยังไม่มีรายการบริการ', message: 'กรุณาติดต่อร้านโดยตรงครับ' });
  }
  return serviceCarousel(rows, shop.shop_name);
}

async function barbersReply(shop) {
  const { rows } = await query(
    `SELECT b.code, b.specialty, b.status, u.full_name
       FROM barbers b JOIN users u ON u.id = b.user_id
      WHERE b.status <> 'off'
      ORDER BY CASE b.status WHEN 'available' THEN 1 WHEN 'serving' THEN 2 ELSE 3 END, b.code`,
  );
  return barbersCard(rows, shop.shop_name);
}

async function pointsReply(lineUserId, shop) {
  const user = await userOf(lineUserId);
  if (!user) return notLinkedCard(shop.shop_name);

  const cfg = await loyaltyConfig();
  if (!cfg.enabled) {
    return card({
      shopName: shop.shop_name,
      title: 'ร้านยังไม่เปิดระบบสะสมแต้ม',
      message: 'ตอนนี้ยังไม่มีโปรแกรมสะสมแต้มครับ ติดตามข่าวได้ที่แชทนี้',
    });
  }

  const tiers = { bronze: ['Bronze', 'Silver', 4000], silver: ['Silver', 'Gold', 12000], gold: ['Gold', 'Platinum', 30000], platinum: ['Platinum', null, null] };
  const [label, next, threshold] = tiers[user.member_tier] || tiers.bronze;

  return pointsCard({
    name: user.full_name,
    points: user.loyalty_points,
    tier: label,
    nextTier: next,
    spendToNext: threshold === null ? 0 : Math.max(threshold - Number(user.total_spent), 0),
    redeemableBaht: Math.floor(user.loyalty_points * cfg.pointValueBaht),
    canRedeem: user.loyalty_points >= cfg.minRedeem,
    minRedeem: cfg.minRedeem,
  });
}

async function promoReply(shop) {
  const { rows } = await query(
    `SELECT code, description, discount_type, discount_value, min_total
       FROM promo_codes
      WHERE is_active = TRUE
        AND (starts_at IS NULL OR starts_at <= NOW())
        AND (ends_at   IS NULL OR ends_at   >= NOW())
        AND (max_uses  IS NULL OR used_count < max_uses)
      ORDER BY discount_value DESC`,
  );
  return promosCard(rows, shop.shop_name);
}

async function historyReply(lineUserId, shop) {
  const user = await userOf(lineUserId);
  if (!user) return notLinkedCard(shop.shop_name);

  const { rows } = await query(
    `SELECT queue_date, ticket_no, service_name, price
       FROM v_queue_board
      WHERE customer_id = $1 AND status = 'done'
      ORDER BY queue_date DESC, seq DESC LIMIT 5`,
    [user.id],
  );

  if (!rows.length) {
    return card({
      shopName: shop.shop_name,
      title: 'ยังไม่มีประวัติการใช้บริการ',
      message: 'มาใช้บริการครั้งแรกกับเราได้เลย กดรับบัตรคิวด้านล่างได้ทันที',
      buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }],
    });
  }

  return card({
    shopName: shop.shop_name,
    title: 'ประวัติการใช้บริการล่าสุด',
    message: `คุณใช้บริการกับเราแล้ว รวมยอดสะสม ${baht(user.total_spent)}`,
    rows: rows.map((r) => [r.queue_date, `${r.service_name} · ${baht(r.price)}`]),
    buttons: [{ label: 'รับบัตรคิวอีกครั้ง', path: '/app/take-queue' }],
  });
}

async function cancelQueueReply(lineUserId, shop) {
  const user = await userOf(lineUserId);
  if (!user) return notLinkedCard(shop.shop_name);

  const { rows } = await query(
    `SELECT ticket_no, status FROM v_queue_board
      WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called')
      ORDER BY seq LIMIT 1`,
    [user.id, shopToday()],
  );

  if (!rows[0]) {
    return card({
      shopName: shop.shop_name,
      title: 'ไม่พบคิวที่ยกเลิกได้',
      message: 'ตอนนี้คุณไม่มีคิวที่รออยู่ หากต้องการยกเลิกการจองล่วงหน้า เปิดแอปแล้วเลือกรายการที่จองไว้ได้เลย',
      buttons: [{ label: 'เปิดแอป', path: '/app/my-queue' }],
    });
  }

  // ไม่ยกเลิกให้จากแชทตรง ๆ เพื่อกันกดพลาด ให้ยืนยันในแอปอีกชั้น
  return card({
    shopName: shop.shop_name,
    title: 'ยืนยันการยกเลิกในแอป',
    message: `คุณมีคิว ${rows[0].ticket_no} อยู่ กดปุ่มด้านล่างเพื่อเปิดแอปแล้วกดยกเลิก ระบบจะถามยืนยันอีกครั้งกันกดพลาดครับ`,
    tone: 'danger',
    buttons: [{ label: 'เปิดแอปเพื่อยกเลิก', path: '/app/my-queue' }],
  });
}

const paymentReply = (shop) => card({
  shopName: shop.shop_name,
  title: 'วิธีชำระเงิน',
  message: 'รับชำระได้หลายช่องทาง เลือกได้ตามสะดวกเลยครับ',
  rows: [
    ['QR พร้อมเพย์', 'สแกนจ่ายในแอป'],
    ['เงินสด', 'จ่ายที่เคาน์เตอร์'],
    ['บัตรเครดิต/เดบิต', 'รับที่หน้าร้าน'],
    ['โอนธนาคาร', 'แจ้งสลิปกับพนักงาน'],
    ['แต้มสะสม', 'ใช้แทนเงินสดได้'],
  ],
  buttons: [{ label: 'รับบัตรคิวและชำระเงิน', path: '/app/take-queue' }],
});

const bookReply = (shop) => (shop.booking_enabled
  ? card({
    shopName: shop.shop_name,
    title: 'จองคิวล่วงหน้า',
    message: `เลือกวัน เวลา บริการ และช่างที่ต้องการได้เลย จองล่วงหน้าได้ถึง ${shop.booking_max_days ?? 14} วัน และลูกค้าที่จองไว้จะได้คิวก่อน walk-in`,
    rows: [['เวลาทำการ', `${shop.open_time} - ${shop.close_time} น.`], ['วันเปิด', shop.open_days]],
    buttons: [{ label: 'เลือกวันและเวลา', path: '/app/book' }, { label: 'ดูบริการและราคา', message: 'ราคา' }],
  })
  : card({
    shopName: shop.shop_name,
    title: 'ตอนนี้ยังไม่เปิดให้จองล่วงหน้า',
    message: 'รับคิวแบบ walk-in ได้ตามเวลาทำการเลยครับ หรือกดรับบัตรคิวออนไลน์ก่อนมาถึงร้านก็ได้',
    buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }],
  }));

const adminReply = (shop) => card({
  shopName: shop.shop_name,
  title: 'ติดต่อพนักงาน',
  message: 'ข้อความของคุณถูกบันทึกไว้ให้พนักงานแล้ว ทีมงานจะตอบกลับในเวลาทำการ หากเร่งด่วนโทรหาเราได้เลยครับ',
  rows: [
    ...(shop.phone ? [['โทรศัพท์', shop.phone]] : []),
    ['เวลาทำการ', `${shop.open_time} - ${shop.close_time} น.`],
  ],
  buttons: shop.phone
    ? [{ label: 'ดูข้อมูลร้าน', message: 'ที่ตั้งร้าน' }]
    : [{ label: 'เปิดแอป', path: '/app/my-queue' }],
});

const helpText = (shop) => ({
  type: 'text',
  text: `สวัสดีครับ 💈 ผมเป็นผู้ช่วยของ ${shop.shop_name}\n`
    + 'พิมพ์คำสั้น ๆ หรือกดเมนูด้านล่างได้เลย\n\n'
    + '• "คิวของฉัน" — ดูคิวและเวลารอ\n'
    + '• "คิวตอนนี้" — คิวหน้าร้านตอนนี้\n'
    + '• "ราคา" — บริการและราคาทั้งหมด\n'
    + '• "จองคิว" — จองล่วงหน้า\n'
    + '• "แต้มของฉัน" — แต้มและระดับสมาชิก\n'
    + '• "โปรโมชัน" — ส่วนลดที่ใช้ได้\n'
    + '• "ที่ตั้งร้าน" — แผนที่และเวลาทำการ\n'
    + '• "ช่าง" — ช่างที่อยู่ร้านวันนี้\n'
    + '• "แอดมิน" — ฝากข้อความถึงพนักงาน',
  quickReply: quickReply(),
});

/* ------------------------------------------------------------------ */
/*  เลือกคำตอบตาม intent                                               */
/* ------------------------------------------------------------------ */

export async function replyFor(intent, { lineUserId, text } = {}) {
  const shop = await publicShopInfo();

  switch (intent) {
    case 'my_queue': return myQueueReply(lineUserId, shop);
    case 'shop_queue': return shopQueueReply(shop);
    case 'cancel_queue': return cancelQueueReply(lineUserId, shop);
    case 'take_queue': return card({
      shopName: shop.shop_name,
      title: 'รับบัตรคิวออนไลน์',
      message: 'เลือกบริการ เลือกช่าง แล้วรับบัตรคิวได้ทันที ระบบจะแจ้งเตือนในแชทนี้เมื่อใกล้ถึงคิวคุณ',
      buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }, { label: 'ดูคิวตอนนี้ก่อน', message: 'คิวตอนนี้' }],
    });
    case 'book': return bookReply(shop);
    case 'price': return priceReply(shop);
    case 'hours': return card({
      shopName: shop.shop_name,
      title: 'เวลาทำการ',
      message: `เปิด ${shop.open_days} เวลา ${shop.open_time} - ${shop.close_time} น.`,
      rows: [['เปิด', `${shop.open_time} น.`], ['ปิด', `${shop.close_time} น.`], ['วันเปิด', shop.open_days]],
      buttons: [{ label: 'ดูคิวตอนนี้', message: 'คิวตอนนี้' }, { label: 'จองล่วงหน้า', message: 'จองคิว' }],
    });
    case 'location':
    case 'contact': return shopInfoCard(shop);
    case 'barbers': return barbersReply(shop);
    case 'points': return pointsReply(lineUserId, shop);
    case 'promo': return promoReply(shop);
    case 'payment': return paymentReply(shop);
    case 'history': return historyReply(lineUserId, shop);
    case 'admin': return adminReply(shop);
    case 'thanks': return {
      type: 'text',
      text: 'ยินดีครับ 🙏 แล้วพบกันที่ร้านนะครับ',
      quickReply: quickReply(),
    };
    case 'greet': return card({
      shopName: shop.shop_name,
      title: `สวัสดีครับ ยินดีต้อนรับสู่ ${shop.shop_name}`,
      message: `เปิด ${shop.open_time} - ${shop.close_time} น. ${shop.open_days}\nอยากทำอะไรดีครับ กดเมนูด้านล่างได้เลย`,
      buttons: [{ label: 'รับบัตรคิว', path: '/app/take-queue' }, { label: 'ดูบริการและราคา', message: 'ราคา' }],
    });
    case 'help': return helpText(shop);
    default: return [
      {
        type: 'text',
        text: `ขออภัยครับ ผมยังไม่เข้าใจคำว่า "${String(text || '').slice(0, 40)}"\n`
          + 'ลองพิมพ์คำสั้น ๆ เช่น "ราคา" "คิวของฉัน" "จองคิว" หรือพิมพ์ "แอดมิน" เพื่อฝากข้อความถึงพนักงานครับ',
      },
      helpText(shop),
    ];
  }
}

/* ------------------------------------------------------------------ */
/*  ผูกบัญชีด้วยรหัสจาก QR                                              */
/* ------------------------------------------------------------------ */

const LINK_FAIL = {
  not_found: 'ไม่พบรหัสนี้ในระบบ กรุณากดปุ่ม "เชื่อมบัญชี" บนหน้าเว็บอีกครั้งเพื่อรับ QR ใหม่',
  used: 'รหัสนี้ถูกใช้ไปแล้ว ถ้ายังไม่ได้เชื่อมบัญชี กรุณาขอ QR ใหม่จากหน้าเว็บ',
  expired: 'รหัสนี้หมดอายุแล้ว กรุณาขอ QR ใหม่จากหน้าเว็บ',
  line_taken: 'บัญชี LINE นี้เชื่อมกับผู้ใช้อื่นอยู่แล้ว กรุณายกเลิกการเชื่อมจากบัญชีเดิมก่อน',
};

async function handleLinkCode(code, lineUserId) {
  const shop = await publicShopInfo();

  if (!lineUserId) {
    return { type: 'text', text: 'ไม่สามารถอ่านบัญชี LINE ของคุณได้ กรุณาลองใหม่อีกครั้งครับ' };
  }

  const profile = await getProfile(lineUserId).catch(() => null);
  const result = await redeemLinkCode(code, {
    userId: lineUserId,
    displayName: profile?.displayName,
    pictureUrl: profile?.pictureUrl,
  });

  if (!result.ok) {
    return [
      card({
        shopName: shop.shop_name,
        title: 'เชื่อมบัญชีไม่สำเร็จ',
        message: LINK_FAIL[result.reason] || 'เกิดข้อผิดพลาด กรุณาลองใหม่อีกครั้ง',
        tone: 'danger',
        buttons: [{ label: 'เปิดแอปของร้าน', path: '/app/my-queue' }],
      }),
      helpText(shop),
    ];
  }

  // ผูกสำเร็จ — ถ้ามีคิวที่รออยู่ ส่งสถานะคิวให้ดูเลย
  const { rows } = await query(
    `SELECT * FROM v_queue_board
      WHERE customer_id = $1 AND queue_date = $2 AND status IN ('waiting','called','serving')
      ORDER BY seq LIMIT 1`,
    [result.user.id, shopToday()],
  );
  // รายการชำระเงินล่าสุดของวันนี้ — บอกลูกค้าเลยว่าจ่ายแล้วหรือยัง
  const { rows: pay } = await query(
    `SELECT p.*, s.name AS service_name, q.ticket_no
       FROM payments p
       JOIN services s ON s.id = p.service_id
       LEFT JOIN queue_tickets q ON q.id = p.ticket_id
      WHERE p.customer_id = $1 AND p.status <> 'cancelled'
        AND (p.created_at AT TIME ZONE $2)::date = $3::date
      ORDER BY p.created_at DESC LIMIT 1`,
    [result.user.id, config.timezone, shopToday()],
  );
  const payment = pay[0];
  // การ์ดชำระเงินแสดงหมายเลขคิวอยู่แล้ว ไม่ต้องแสดงซ้ำในการ์ดเชื่อมบัญชี
  const ticket = payment ? null : rows[0];

  const success = card({
    shopName: shop.shop_name,
    title: 'เชื่อมบัญชีเรียบร้อยแล้ว',
    message: ticket
      ? `สวัสดีคุณ ${result.user.full_name} ตั้งแต่นี้เราจะแจ้งเตือนในแชทนี้เมื่อใกล้ถึงคิวและเมื่อถึงคิวของคุณ`
      : `สวัสดีคุณ ${result.user.full_name} ตั้งแต่นี้เราจะแจ้งเตือนคิวและสถานะการชำระเงินให้ที่แชทนี้`,
    tone: 'ok',
    ticketNo: ticket?.ticket_no,
    rows: ticket
      ? [
        ['บริการ', ticket.service_name],
        ['สถานะ', { waiting: 'กำลังรอคิว', called: 'ถึงคิวแล้ว', serving: 'กำลังให้บริการ' }[ticket.status]],
        ...(ticket.barber_name ? [['ช่าง', ticket.barber_name]] : []),
      ]
      : [],
    buttons: [{ label: ticket ? 'ดูคิวของฉัน' : 'รับบัตรคิว', path: ticket ? '/app/my-queue' : '/app/take-queue' }],
  });

  await logMessage({
    lineUserId, userId: result.user.id, direction: 'out', intent: 'link_account',
    text: payment ? `เชื่อมบัญชีสำเร็จ | ${payment.status === 'paid' ? 'ชำระเงินแล้ว' : 'ยังไม่ได้ชำระเงิน'} ${payment.ref_code}` : 'เชื่อมบัญชีสำเร็จ',
  });
  return payment
    ? [success, paymentCard(payment, shop.shop_name), helpText(shop)]
    : [success, helpText(shop)];
}

/* ------------------------------------------------------------------ */
/*  จัดการ event จาก webhook                                           */
/* ------------------------------------------------------------------ */

export async function handleEvent(event) {
  const lineUserId = event.source?.userId;

  if (event.type === 'follow') {
    const shop = await publicShopInfo();
    await logMessage({ lineUserId, direction: 'in', intent: 'follow', text: '(เพิ่มเพื่อน)' });
    return replyMessage(event.replyToken, [
      card({
        shopName: shop.shop_name,
        title: `ยินดีต้อนรับสู่ ${shop.shop_name}`,
        message: 'รับบัตรคิว จองล่วงหน้า เช็กคิว สะสมแต้ม และรับแจ้งเตือนเมื่อใกล้ถึงคิว ได้ครบในแชทนี้เลยครับ',
        rows: [['เวลาทำการ', `${shop.open_time} - ${shop.close_time} น.`], ['วันเปิด', shop.open_days]],
        buttons: [{ label: 'เริ่มใช้งาน / รับบัตรคิว', path: '/app/take-queue' }],
      }),
      helpText(shop),
    ]);
  }

  if (event.type === 'unfollow' && lineUserId) {
    // บล็อก OA แล้วส่งข้อความไม่ได้ -> เลิกผูกไว้ก่อน
    await query(
      'UPDATE users SET line_user_id = NULL, line_linked_at = NULL WHERE line_user_id = $1', [lineUserId],
    );
    await logMessage({ lineUserId, direction: 'in', intent: 'unfollow', text: '(บล็อก/ลบเพื่อน)' });
    return null;
  }

  if (event.type === 'message' && event.message?.type === 'text') {
    const text = event.message.text;

    // ลูกค้าสแกน QR ผูกบัญชีแล้วส่งข้อความที่มีรหัสมา — จัดการก่อนเข้าระบบ intent
    const linkCode = text.match(LINK_RE)?.[0];
    if (linkCode) {
      await logMessage({ lineUserId, direction: 'in', intent: 'link_account', text });
      return replyMessage(event.replyToken, await handleLinkCode(linkCode, lineUserId));
    }

    const intent = detectIntent(text);
    const user = await userOf(lineUserId);

    await logMessage({ lineUserId, userId: user?.id, direction: 'in', intent, text });

    const reply = await replyFor(intent, { lineUserId, text });
    const messages = [].concat(reply);
    // ใส่เมนูลัดไว้กับข้อความสุดท้ายเสมอ
    const last = messages[messages.length - 1];
    if (last && !last.quickReply) last.quickReply = quickReply();

    await logMessage({ lineUserId, userId: user?.id, direction: 'out', intent, text: messages.map((m) => m.altText || m.text).join(' | ') });
    return replyMessage(event.replyToken, messages);
  }

  // ลูกค้าส่งรูป/สติกเกอร์ — ตอบให้รู้ว่าเราเห็น แต่ยังอ่านไม่ได้
  if (event.type === 'message') {
    const shop = await publicShopInfo();
    return replyMessage(event.replyToken, {
      type: 'text',
      text: event.message?.type === 'sticker'
        ? 'ขอบคุณครับ 😊 มีอะไรให้ช่วยไหมครับ กดเมนูด้านล่างได้เลย'
        : `ได้รับไฟล์แล้วครับ ถ้าเป็นสลิปการโอน รบกวนส่งผ่านแอปของร้านเพื่อให้ระบบตรวจอัตโนมัติ หรือโทรหาเราที่ ${shop.phone || 'เบอร์ร้าน'} ครับ`,
      quickReply: quickReply(),
    });
  }

  if (event.type === 'postback') {
    const data = new URLSearchParams(event.postback?.data || '');
    const intent = data.get('intent') || data.get('action') || 'help';
    await logMessage({ lineUserId, direction: 'in', intent, text: `(postback) ${event.postback?.data}` });

    const reply = await replyFor(intent === 'shop' ? 'shop_queue' : intent, { lineUserId });
    const messages = [].concat(reply);
    const last = messages[messages.length - 1];
    if (last && !last.quickReply) last.quickReply = quickReply();
    return replyMessage(event.replyToken, messages);
  }

  return null;
}

export { appUrl };
