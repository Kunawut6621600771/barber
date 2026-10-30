/**
 * Flex Message สำเร็จรูปสำหรับ LINE Bot ของร้าน
 * แยกจาก utils/line.js เพื่อให้ไฟล์นั้นเหลือแค่การคุยกับ LINE API
 */
import { appUrl } from './line.js';

export const COLORS = {
  brand: '#DC2626',
  brandDark: '#991B1B',
  ink: '#111827',
  muted: '#6B7280',
  line: '#E5E7EB',
  ok: '#15803D',
  warn: '#B45309',
  gold: '#B45309',
};

const baht = (n) => `฿${Number(n || 0).toLocaleString('th-TH', { maximumFractionDigits: 2 })}`;

const text = (t, o = {}) => ({ type: 'text', text: String(t ?? '—'), wrap: true, ...o });

export const kv = (label, value, opts = {}) => ({
  type: 'box',
  layout: 'horizontal',
  spacing: 'md',
  contents: [
    text(label, { size: 'sm', color: COLORS.muted, flex: 2 }),
    text(value, { size: 'sm', color: opts.color || COLORS.ink, flex: 3, align: 'end', weight: opts.bold ? 'bold' : 'regular' }),
  ],
});

const uriButton = (label, path, style = 'primary') => ({
  type: 'button',
  style,
  height: 'sm',
  color: style === 'primary' ? COLORS.ink : undefined,
  action: { type: 'uri', label: label.slice(0, 20), uri: appUrl(path) },
});

const msgButton = (label, message) => ({
  type: 'button',
  style: 'secondary',
  height: 'sm',
  action: { type: 'message', label: label.slice(0, 20), text: message },
});

/* ------------------------------------------------------------------ */
/*  การ์ดทั่วไป                                                        */
/* ------------------------------------------------------------------ */

/**
 * การ์ดมาตรฐานของร้าน
 * @param {{title, message?, ticketNo?, rows?, tone?, buttons?, shopName?}} p
 */
export function card({
  title, message, ticketNo, rows = [], tone = 'brand',
  buttons = [{ label: 'เปิดดูคิวของฉัน', path: '/app/my-queue' }],
  shopName = 'Trim & Co.',
}) {
  const body = [];

  if (ticketNo) {
    body.push(text('หมายเลขคิวของคุณ', { size: 'xs', color: COLORS.muted, align: 'center' }));
    body.push(text(ticketNo, { size: '4xl', weight: 'bold', color: COLORS.ink, align: 'center' }));
  }
  if (message) body.push(text(message, { size: 'sm', color: COLORS.ink, margin: 'md' }));
  if (rows.length) {
    body.push({ type: 'separator', margin: 'lg', color: COLORS.line });
    body.push({
      type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg',
      contents: rows.map(([l, v, o]) => kv(l, v, o || {})),
    });
  }

  return {
    type: 'flex',
    altText: `${title}${ticketNo ? ` — คิว ${ticketNo}` : ''}${message ? `: ${message}` : ''}`.slice(0, 390),
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px',
        backgroundColor: tone === 'danger' ? COLORS.brandDark : tone === 'ok' ? COLORS.ok : COLORS.brand,
        contents: [
          text(shopName, { size: 'xs', color: '#FFFFFFCC', weight: 'bold' }),
          text(title, { size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' }),
        ],
      },
      body: { type: 'box', layout: 'vertical', spacing: 'sm', contents: body.length ? body : [text(' ')] },
      footer: buttons.length ? {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: buttons.map((b, i) => (b.message
          ? msgButton(b.label, b.message)
          : uriButton(b.label, b.path, i === 0 ? 'primary' : 'secondary'))),
      } : undefined,
    },
  };
}

/* ------------------------------------------------------------------ */
/*  เมนูบริการ (carousel)                                              */
/* ------------------------------------------------------------------ */

/** แสดงบริการเป็นการ์ดเลื่อนได้ สูงสุด 10 ใบ (ข้อจำกัดของ LINE) */
export function serviceCarousel(services, shopName = 'Trim & Co.') {
  const groups = [];
  const perBubble = 5;

  for (let i = 0; i < services.length && groups.length < 10; i += perBubble) {
    groups.push(services.slice(i, i + perBubble));
  }

  const bubbles = groups.map((group, idx) => ({
    type: 'bubble',
    size: 'mega',
    header: {
      type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: COLORS.ink,
      contents: [
        text(shopName, { size: 'xs', color: '#FFFFFF99', weight: 'bold' }),
        text(idx === 0 ? 'บริการและราคา' : `บริการและราคา (${idx + 1})`, {
          size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm',
        }),
      ],
    },
    body: {
      type: 'box', layout: 'vertical', spacing: 'md',
      contents: group.flatMap((s, i) => [
        ...(i > 0 ? [{ type: 'separator', color: COLORS.line }] : []),
        {
          type: 'box', layout: 'vertical', spacing: 'xs',
          contents: [
            {
              type: 'box', layout: 'horizontal',
              contents: [
                text(s.name, { size: 'sm', weight: 'bold', color: COLORS.ink, flex: 3 }),
                text(baht(s.price), { size: 'sm', weight: 'bold', color: COLORS.brand, flex: 2, align: 'end' }),
              ],
            },
            text(`⏱ ประมาณ ${s.duration_min} นาที`, { size: 'xxs', color: COLORS.muted }),
          ],
        },
      ]),
    },
    footer: {
      type: 'box', layout: 'vertical', spacing: 'sm',
      contents: [uriButton('รับบัตรคิวเลย', '/app/take-queue'), uriButton('จองล่วงหน้า', '/app/book', 'secondary')],
    },
  }));

  return {
    type: 'flex',
    altText: `บริการและราคาของ ${shopName}`,
    contents: bubbles.length === 1 ? bubbles[0] : { type: 'carousel', contents: bubbles },
  };
}

/* ------------------------------------------------------------------ */
/*  การ์ดเฉพาะเรื่อง                                                    */
/* ------------------------------------------------------------------ */

/** ข้อมูลร้าน: ที่อยู่ เวลาเปิด เบอร์โทร */
export function shopInfoCard(info) {
  const buttons = [{ label: 'รับบัตรคิว', path: '/app/take-queue' }];
  const contents = [
    kv('เวลาทำการ', `${info.open_time} - ${info.close_time} น.`),
    kv('วันเปิด', info.open_days),
    ...(info.phone ? [kv('โทรศัพท์', info.phone)] : []),
  ];

  return {
    type: 'flex',
    altText: `${info.shop_name} · เปิด ${info.open_time}-${info.close_time} น.`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: COLORS.brand,
        contents: [
          text(info.shop_name, { size: 'lg', color: '#FFFFFF', weight: 'bold' }),
          ...(info.tagline ? [text(info.tagline, { size: 'xs', color: '#FFFFFFCC', margin: 'xs' })] : []),
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...contents,
          ...(info.address ? [
            { type: 'separator', margin: 'lg', color: COLORS.line },
            text('ที่อยู่', { size: 'xs', color: COLORS.muted, margin: 'lg' }),
            text(info.address, { size: 'sm', color: COLORS.ink, margin: 'xs' }),
          ] : []),
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          ...(info.map_url ? [{
            type: 'button', style: 'primary', height: 'sm', color: COLORS.ink,
            action: { type: 'uri', label: 'เปิดแผนที่', uri: info.map_url },
          }] : []),
          ...(info.phone ? [{
            type: 'button', style: 'secondary', height: 'sm',
            action: { type: 'uri', label: 'โทรหาร้าน', uri: `tel:${String(info.phone).replace(/[^0-9+]/g, '')}` },
          }] : []),
          ...buttons.map((b) => uriButton(b.label, b.path, 'secondary')),
        ],
      },
    },
  };
}

/** แต้มสะสมและระดับสมาชิก */
export function pointsCard({ name, points, tier, spendToNext, nextTier, redeemableBaht, canRedeem, minRedeem }) {
  return {
    type: 'flex',
    altText: `คุณมี ${points} แต้ม (${tier})`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: COLORS.ink,
        contents: [
          text(name || 'สมาชิก', { size: 'xs', color: '#FFFFFF99' }),
          text(`สมาชิกระดับ ${tier}`, { size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'xs' }),
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [
          text('แต้มคงเหลือ', { size: 'xs', color: COLORS.muted, align: 'center' }),
          text(String(points), { size: '4xl', weight: 'bold', color: COLORS.brand, align: 'center' }),
          text(`ใช้แทนเงินได้ ${baht(redeemableBaht)}`, { size: 'xs', color: COLORS.muted, align: 'center' }),
          { type: 'separator', margin: 'lg', color: COLORS.line },
          {
            type: 'box', layout: 'vertical', spacing: 'sm', margin: 'lg',
            contents: [
              kv('แลกได้', canRedeem ? 'ใช้ได้แล้ว' : `ต้องมีอย่างน้อย ${minRedeem} แต้ม`,
                { color: canRedeem ? COLORS.ok : COLORS.warn }),
              ...(nextTier ? [kv(`อีกเท่าไรถึง ${nextTier}`, baht(spendToNext))] : []),
            ],
          },
        ],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [uriButton('ดูรายละเอียดในแอป', '/app/profile')],
      },
    },
  };
}

/** รายการช่างและสถานะตอนนี้ */
export function barbersCard(barbers, shopName = 'Trim & Co.') {
  const label = { available: 'ว่าง', serving: 'กำลังให้บริการ', break: 'พักอยู่', off: 'ไม่อยู่' };
  const color = { available: COLORS.ok, serving: COLORS.brand, break: COLORS.warn, off: COLORS.muted };

  return {
    type: 'flex',
    altText: `ช่างของ ${shopName} วันนี้`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: COLORS.brand,
        contents: [
          text(shopName, { size: 'xs', color: '#FFFFFFCC', weight: 'bold' }),
          text('ช่างที่ร้านวันนี้', { size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' }),
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'md',
        contents: barbers.length ? barbers.slice(0, 8).map((b) => ({
          type: 'box', layout: 'horizontal', spacing: 'sm',
          contents: [
            {
              type: 'box', layout: 'vertical', flex: 3,
              contents: [
                text(b.full_name, { size: 'sm', weight: 'bold', color: COLORS.ink }),
                text(b.specialty || b.code, { size: 'xxs', color: COLORS.muted }),
              ],
            },
            text(label[b.status] || b.status, {
              size: 'xs', flex: 2, align: 'end', color: color[b.status] || COLORS.muted, weight: 'bold',
            }),
          ],
        })) : [text('วันนี้ยังไม่มีข้อมูลช่าง', { size: 'sm', color: COLORS.muted })],
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [uriButton('เลือกช่างและรับคิว', '/app/take-queue')],
      },
    },
  };
}

/** โปรโมชันที่ใช้ได้ตอนนี้ */
export function promosCard(promos, shopName = 'Trim & Co.') {
  if (!promos.length) {
    return card({
      title: 'ตอนนี้ยังไม่มีโปรโมชัน',
      message: 'ติดตามข่าวสารได้ที่แชทนี้ มีโปรเมื่อไรเราแจ้งให้ทราบก่อนใครแน่นอน',
      buttons: [{ label: 'ดูบริการและราคา', message: 'ราคา' }],
      shopName,
    });
  }

  return {
    type: 'flex',
    altText: `โปรโมชันของ ${shopName}`,
    contents: {
      type: 'bubble',
      header: {
        type: 'box', layout: 'vertical', paddingAll: '16px', backgroundColor: COLORS.brand,
        contents: [
          text(shopName, { size: 'xs', color: '#FFFFFFCC', weight: 'bold' }),
          text('โปรโมชันที่ใช้ได้ตอนนี้', { size: 'lg', color: '#FFFFFF', weight: 'bold', margin: 'sm' }),
        ],
      },
      body: {
        type: 'box', layout: 'vertical', spacing: 'lg',
        contents: promos.slice(0, 6).flatMap((p, i) => [
          ...(i > 0 ? [{ type: 'separator', color: COLORS.line }] : []),
          {
            type: 'box', layout: 'vertical', spacing: 'xs',
            contents: [
              {
                type: 'box', layout: 'horizontal',
                contents: [
                  text(p.code, { size: 'sm', weight: 'bold', color: COLORS.brand, flex: 3 }),
                  text(p.discount_type === 'percent' ? `ลด ${p.discount_value}%` : `ลด ${baht(p.discount_value)}`,
                    { size: 'sm', weight: 'bold', color: COLORS.ink, flex: 2, align: 'end' }),
                ],
              },
              text(p.description || 'ใช้โค้ดนี้ที่หน้าร้าน', { size: 'xxs', color: COLORS.muted }),
              ...(p.min_total > 0 ? [text(`เมื่อซื้อครบ ${baht(p.min_total)}`, { size: 'xxs', color: COLORS.muted })] : []),
            ],
          },
        ]),
      },
      footer: {
        type: 'box', layout: 'vertical', spacing: 'sm',
        contents: [uriButton('รับบัตรคิว', '/app/take-queue')],
      },
    },
  };
}

/** เมนูลัดใต้ข้อความ */
export const quickReply = () => ({
  items: [
    { type: 'action', action: { type: 'uri', label: '🎫 รับบัตรคิว', uri: appUrl('/app/take-queue') } },
    { type: 'action', action: { type: 'message', label: '📋 คิวของฉัน', text: 'คิวของฉัน' } },
    { type: 'action', action: { type: 'message', label: '👀 คิวตอนนี้', text: 'คิวตอนนี้' } },
    { type: 'action', action: { type: 'message', label: '💵 ราคา', text: 'ราคา' } },
    { type: 'action', action: { type: 'message', label: '⭐ แต้มของฉัน', text: 'แต้มของฉัน' } },
    { type: 'action', action: { type: 'message', label: '📍 ที่ตั้งร้าน', text: 'ที่ตั้งร้าน' } },
    { type: 'action', action: { type: 'message', label: '📅 จองล่วงหน้า', text: 'จองคิว' } },
    { type: 'action', action: { type: 'message', label: '❓ ช่วยเหลือ', text: 'ช่วยเหลือ' } },
  ],
});
