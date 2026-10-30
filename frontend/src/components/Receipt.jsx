import { baht, dateTimeOf } from './ui.jsx';

const METHOD_LABEL = {
  cash: 'เงินสด',
  promptpay: 'QR พร้อมเพย์',
  card: 'บัตรเครดิต/เดบิต',
  transfer: 'โอนธนาคาร',
  points: 'แต้มสะสม',
  other: 'อื่น ๆ',
};

/**
 * ใบเสร็จรับเงิน — แสดงบนจอได้ และสั่งพิมพ์ลงกระดาษความร้อน 80 มม. ได้เลย
 * (CSS @media print ใน app.css ซ่อนทุกอย่างยกเว้นกล่องนี้)
 */
export default function Receipt({ sale, shop }) {
  if (!sale) return null;

  const line = (l, r, cls = '') => (
    <div className={`r-row ${cls}`}>
      <span className="l">{l}</span>
      <span className="r">{r}</span>
    </div>
  );

  return (
    <div className="receipt">
      <div className="r-center">
        <div className="r-shop">{shop?.name || 'ร้านตัดผม'}</div>
        {shop?.address && <div>{shop.address}</div>}
        {shop?.phone && <div>โทร. {shop.phone}</div>}
        {shop?.tax_id && <div>เลขผู้เสียภาษี {shop.tax_id}</div>}
      </div>

      <hr className="r-hr" />

      {line('เลขที่บิล', sale.bill_no)}
      {line('วันที่', dateTimeOf(sale.paid_at || sale.created_at))}
      {sale.ticket_no && line('คิว', sale.ticket_no)}
      {sale.customer_name && line('ลูกค้า', sale.customer_name)}
      {sale.barber_name && line('ช่าง', sale.barber_name)}
      {sale.cashier_name && line('พนักงานขาย', sale.cashier_name)}

      <hr className="r-hr" />

      {sale.items?.map((item) => (
        <div key={item.id} className="r-item">
          <div className="r-row">
            <span className="l">{item.name}</span>
            <span className="r">{baht(item.line_total)}</span>
          </div>
          <div className="sub">
            {item.qty} x {baht(item.unit_price)}
            {Number(item.discount_amount) > 0 && ` · ลด ${baht(item.discount_amount)}`}
            {item.barber_name && ` · ${item.barber_name}`}
          </div>
        </div>
      ))}

      <hr className="r-hr" />

      {line('ยอดรวม', baht(sale.subtotal))}
      {Number(sale.discount_amount) > 0
        && line(`ส่วนลด${sale.promo_code ? ` (${sale.promo_code})` : ''}`, `-${baht(sale.discount_amount)}`)}
      {Number(sale.points_discount) > 0
        && line(`ใช้แต้ม ${sale.points_used} แต้ม`, `-${baht(sale.points_discount)}`)}
      {Number(sale.tax_amount) > 0 && line(`ภาษี ${sale.tax_rate}%`, baht(sale.tax_amount))}

      <hr className="r-hr" />
      {line('ยอดสุทธิ', baht(sale.total), 'r-grand')}

      {sale.payments?.map((p) => (
        <div key={p.id}>
          {line(METHOD_LABEL[p.method] || p.method, baht(p.amount))}
          {p.reference && <div className="sub">อ้างอิง {p.reference}</div>}
        </div>
      ))}
      {Number(sale.change_amount) > 0 && line('เงินทอน', baht(sale.change_amount))}

      {Number(sale.refunded_amount) > 0 && (
        <>
          <hr className="r-hr" />
          {line('คืนเงินแล้ว', `-${baht(sale.refunded_amount)}`)}
        </>
      )}

      {sale.points_earned > 0 && (
        <>
          <hr className="r-hr" />
          <div className="r-center">
            ได้รับแต้มสะสม {sale.points_earned} แต้ม
            {sale.loyalty_points != null && ` · คงเหลือ ${sale.loyalty_points} แต้ม`}
          </div>
        </>
      )}

      <hr className="r-hr" />
      <div className="r-center r-foot">
        {shop?.footer || 'ขอบคุณที่ใช้บริการ'}
        <div style={{ marginTop: 4 }}>** ไม่ใช่ใบกำกับภาษี **</div>
      </div>
    </div>
  );
}

export { METHOD_LABEL };
