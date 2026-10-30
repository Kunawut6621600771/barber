import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, Modal, Field, Empty, Loading, Alert, baht, timeOf,
} from '../components/ui.jsx';
import Receipt from '../components/Receipt.jsx';

const METHODS = [
  { key: 'cash', label: 'เงินสด', ic: '💵' },
  { key: 'promptpay', label: 'QR พร้อมเพย์', ic: '📱' },
  { key: 'card', label: 'บัตร', ic: '💳' },
  { key: 'transfer', label: 'โอน', ic: '🏦' },
];

const QUICK_CASH = [20, 50, 100, 500, 1000];
const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;

export default function Pos() {
  const toast = useToast();
  const { user } = useAuth();

  /* ---------------------------- ข้อมูลอ้างอิง ---------------------------- */
  const [services, setServices] = useState([]);
  const [products, setProducts] = useState([]);
  const [barbers, setBarbers] = useState([]);
  const [customers, setCustomers] = useState([]);
  const [tickets, setTickets] = useState([]);
  const [shift, setShift] = useState(null);
  const [loading, setLoading] = useState(true);

  /* ------------------------------ บิลปัจจุบัน ----------------------------- */
  const [sale, setSale] = useState(null);
  const [openBills, setOpenBills] = useState([]);
  const [busy, setBusy] = useState(false);

  /* --------------------------------- UI --------------------------------- */
  const [tab, setTab] = useState('service');
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [payOpen, setPayOpen] = useState(false);
  const [receipt, setReceipt] = useState(null);
  const [newBillOpen, setNewBillOpen] = useState(false);
  const [voidOpen, setVoidOpen] = useState(false);
  const [discountOpen, setDiscountOpen] = useState(false);
  const [openShiftModal, setOpenShiftModal] = useState(false);

  /* ------------------------------- โหลดข้อมูล ----------------------------- */
  const loadRefs = useCallback(async () => {
    try {
      const [svc, prod, brb, usr, tk, sh, bills] = await Promise.all([
        api.get('/services', { active_only: 'true' }),
        api.get('/products', { active_only: 'true' }),
        api.get('/barbers'),
        api.get('/users', { role: 'customer', limit: 300 }),
        api.get('/queue', { status: 'called,serving' }),
        api.get('/shifts/current'),
        api.get('/pos/sales/open'),
      ]);
      setServices(svc.data);
      setProducts(prod.data);
      setBarbers(brb.data);
      setCustomers(usr.data);
      setTickets(tk.data);
      setShift(sh.shift);
      setOpenBills(bills.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadRefs(); }, [loadRefs]);

  const refreshOpenBills = useCallback(async () => {
    try { setOpenBills((await api.get('/pos/sales/open')).data); } catch { /* ไม่สำคัญพอจะรบกวนผู้ใช้ */ }
  }, []);

  /* ------------------------------ การกระทำ ------------------------------ */
  const run = useCallback(async (fn, successMsg) => {
    setBusy(true);
    try {
      const result = await fn();
      if (result?.sale) setSale(result.sale);
      if (successMsg) toast.success(successMsg);
      return result;
    } catch (err) {
      toast.error(err instanceof ApiError ? err.message : 'เกิดข้อผิดพลาด');
      return null;
    } finally {
      setBusy(false);
    }
  }, [toast]);

  const createBill = async (payload) => {
    const r = await run(() => api.post('/pos/sales', payload));
    if (r) {
      setNewBillOpen(false);
      refreshOpenBills();
      toast.success(r.message);
    }
  };

  const openBill = async (id) => {
    const r = await run(() => api.get(`/pos/sales/${id}`));
    if (r) setSale(r.sale);
  };

  const addItem = (item) => {
    if (!sale) { toast.error('กรุณาเปิดบิลก่อน'); return; }
    // สินค้าเดิมที่มีอยู่แล้วในบิล ให้เพิ่มจำนวนแทนการเพิ่มบรรทัดใหม่
    const existing = sale.items.find(
      (i) => (item.kind === 'product' ? i.product_id === item.id : i.service_id === item.id)
        && i.kind === item.kind && Number(i.discount_amount) === 0,
    );
    if (existing) {
      run(() => api.patch(`/pos/sales/${sale.id}/items/${existing.id}`, { qty: existing.qty + 1 }));
      return;
    }
    run(() => api.post(`/pos/sales/${sale.id}/items`, {
      kind: item.kind,
      ...(item.kind === 'service' ? { service_id: item.id } : { product_id: item.id }),
      qty: 1,
    }));
  };

  const setQty = (item, qty) => {
    if (qty <= 0) { run(() => api.del(`/pos/sales/${sale.id}/items/${item.id}`)); return; }
    run(() => api.patch(`/pos/sales/${sale.id}/items/${item.id}`, { qty }));
  };

  const closeBill = () => { setSale(null); refreshOpenBills(); };

  const voidBill = async (reason) => {
    const r = await run(() => api.post(`/pos/sales/${sale.id}/void`, { reason }));
    if (r) {
      toast.success(r.message);
      setVoidOpen(false);
      closeBill();
    }
  };

  const afterPaid = async (paidSale) => {
    setPayOpen(false);
    try {
      const rc = await api.get(`/pos/sales/${paidSale.id}/receipt`);
      setReceipt(rc);
    } catch {
      setReceipt({ sale: paidSale, shop: null });
    }
    setSale(null);
    refreshOpenBills();
    loadRefs();
  };

  /* ------------------------------ รายการที่แสดง --------------------------- */
  const catalog = useMemo(() => {
    const q = search.trim().toLowerCase();
    const list = tab === 'service'
      ? services.map((s) => ({
        kind: 'service', id: s.id, name: s.name, price: Number(s.price),
        sub: `${s.duration_min} นาที`, category: s.category_name || 'บริการ',
      }))
      : products.map((p) => ({
        kind: 'product', id: p.id, name: p.name, price: Number(p.price),
        sub: p.sku || '', category: p.category,
        stock: p.track_stock ? p.stock_qty : null, low: p.is_low_stock,
      }));

    return list.filter((i) => (!category || i.category === category)
      && (!q || i.name.toLowerCase().includes(q) || (i.sub || '').toLowerCase().includes(q)));
  }, [tab, services, products, search, category]);

  const categories = useMemo(() => {
    const src = tab === 'service'
      ? services.map((s) => s.category_name || 'บริการ')
      : products.map((p) => p.category);
    return [...new Set(src.filter(Boolean))].sort();
  }, [tab, services, products]);

  if (loading) {
    return <div className="page"><Loading rows={6} /></div>;
  }

  return (
    <div className="page">
      <div className="page-head row-between wrap">
        <div>
          <h1>ขายหน้าร้าน (POS)</h1>
          <div className="sub">
            {shift
              ? `กะเปิดอยู่ · ${shift.bills} บิล · ยอด ${baht(shift.sales_total)} · เปิดเมื่อ ${timeOf(shift.opened_at)}`
              : 'ยังไม่ได้เปิดกะ — เปิดกะก่อนเริ่มขายเพื่อให้สรุปเงินสดตอนปิดร้านถูกต้อง'}
          </div>
        </div>
        <div className="row gap-2 wrap">
          {!shift && (
            <button className="btn danger" onClick={() => setOpenShiftModal(true)}>เปิดกะ</button>
          )}
          <button className="btn primary" onClick={() => setNewBillOpen(true)}>+ เปิดบิลใหม่</button>
        </div>
      </div>

      {!shift && (
        <Alert kind="info">
          ยังไม่ได้เปิดกะ ขายได้ตามปกติ แต่บิลจะยังไม่ถูกนับเข้ากะใด กด &quot;เปิดกะ&quot; เพื่อให้สรุปเงินสดตอนปิดร้านตรงกัน
        </Alert>
      )}

      {openBills.length > 0 && (
        <div className="scroll-x mt-2" style={{ marginBottom: 14 }}>
          <div className="row gap-2" style={{ minWidth: 'min-content' }}>
            <span className="small muted" style={{ whiteSpace: 'nowrap' }}>บิลที่เปิดค้าง:</span>
            {openBills.map((b) => (
              <button
                key={b.id}
                className={`chip ${sale?.id === b.id ? 'active' : ''}`}
                onClick={() => openBill(b.id)}
              >
                {b.bill_no} · {b.customer_name || 'ไม่ระบุ'} · {baht(b.total)}
              </button>
            ))}
          </div>
        </div>
      )}

      <div className="pos">
        {/* ------------------------- แคตตาล็อก ------------------------- */}
        <div className="pos-catalog col gap-3">
          <div className="row gap-2 wrap">
            <div className="chips">
              <button className={`chip ${tab === 'service' ? 'active' : ''}`} onClick={() => { setTab('service'); setCategory(''); }}>
                ✂ บริการ ({services.length})
              </button>
              <button className={`chip ${tab === 'product' ? 'active' : ''}`} onClick={() => { setTab('product'); setCategory(''); }}>
                🧴 สินค้า ({products.length})
              </button>
            </div>
            <div className="grow" />
            <input
              className="input"
              style={{ maxWidth: 240 }}
              placeholder="ค้นหาชื่อหรือรหัส..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>

          {categories.length > 1 && (
            <div className="chips">
              <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>ทั้งหมด</button>
              {categories.map((c) => (
                <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
              ))}
            </div>
          )}

          {catalog.length === 0 ? (
            <Card><Empty icon="🔍" title="ไม่พบรายการที่ค้นหา" hint="ลองเปลี่ยนคำค้นหรือหมวดหมู่" /></Card>
          ) : (
            <div className="pos-tiles">
              {catalog.map((item) => {
                const out = item.stock !== null && item.stock !== undefined && item.stock <= 0;
                return (
                  <button
                    key={`${item.kind}-${item.id}`}
                    className="pos-tile"
                    onClick={() => addItem(item)}
                    disabled={!sale || busy || out}
                    title={!sale ? 'เปิดบิลก่อนจึงจะเพิ่มรายการได้' : out ? 'สินค้าหมด' : `เพิ่ม ${item.name}`}
                  >
                    <div>
                      <div className="nm">{item.name}</div>
                      {item.sub && <div className="sub">{item.sub}</div>}
                    </div>
                    <div className="row-between">
                      <span className="pr">{baht(item.price)}</span>
                      {item.stock !== null && item.stock !== undefined && (
                        <span className={`stock-pill ${out ? 'out' : item.low ? 'low' : ''}`}>
                          {out ? 'หมด' : `เหลือ ${item.stock}`}
                        </span>
                      )}
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* --------------------------- ตะกร้า --------------------------- */}
        <div className="pos-cart">
          {!sale ? (
            <div style={{ padding: 10 }}>
              <Empty
                icon="🧾"
                title="ยังไม่ได้เปิดบิล"
                hint="กด “เปิดบิลใหม่” เพื่อเริ่มขาย หรือเลือกบิลที่เปิดค้างด้านบน"
              />
              <button className="btn primary block" onClick={() => setNewBillOpen(true)}>+ เปิดบิลใหม่</button>
            </div>
          ) : (
            <>
              <div className="pos-cart-head">
                <div style={{ minWidth: 0 }}>
                  <div className="bold">{sale.bill_no}</div>
                  <div className="tiny muted">
                    {sale.customer_name || 'ไม่ระบุลูกค้า'}
                    {sale.ticket_no && ` · คิว ${sale.ticket_no}`}
                    {sale.member_tier && ` · ${sale.member_tier}`}
                  </div>
                </div>
                <div className="row gap-1">
                  <button className="btn ghost sm" onClick={() => setDiscountOpen(true)} title="ส่วนลด / แต้ม">%</button>
                  <button className="btn ghost sm" onClick={() => setVoidOpen(true)} title="ยกเลิกบิล">🗑</button>
                  <button className="btn ghost sm" onClick={closeBill} title="พักบิลไว้ก่อน">✕</button>
                </div>
              </div>

              <div className="pos-cart-items">
                {sale.items.length === 0 ? (
                  <Empty icon="🛒" title="ยังไม่มีรายการ" hint="กดที่การ์ดบริการหรือสินค้าทางซ้าย" />
                ) : sale.items.map((item) => (
                  <div key={item.id} className="pos-line">
                    <div className="grow" style={{ minWidth: 0 }}>
                      <div className="nm">{item.name}</div>
                      <div className="meta">
                        {baht(item.unit_price)} / หน่วย
                        {item.barber_name && ` · ${item.barber_name}`}
                        {Number(item.discount_amount) > 0 && ` · ลด ${baht(item.discount_amount)}`}
                      </div>
                      <div className="row gap-2 mt-1">
                        <div className="qty-ctl">
                          <button onClick={() => setQty(item, item.qty - 1)} disabled={busy}>−</button>
                          <span className="n">{item.qty}</span>
                          <button onClick={() => setQty(item, item.qty + 1)} disabled={busy}>+</button>
                        </div>
                      </div>
                    </div>
                    <span className="amt">{baht(item.line_total)}</span>
                  </div>
                ))}
              </div>

              <div className="pos-totals">
                <div className="pos-total-row">
                  <span className="muted">ยอดรวม</span>
                  <span>{baht(sale.subtotal)}</span>
                </div>
                {Number(sale.discount_amount) > 0 && (
                  <div className="pos-total-row">
                    <span className="muted">ส่วนลด{sale.promo_code ? ` (${sale.promo_code})` : ''}</span>
                    <span className="neg">−{baht(sale.discount_amount)}</span>
                  </div>
                )}
                {Number(sale.points_discount) > 0 && (
                  <div className="pos-total-row">
                    <span className="muted">ใช้แต้ม {sale.points_used} แต้ม</span>
                    <span className="neg">−{baht(sale.points_discount)}</span>
                  </div>
                )}
                {Number(sale.tax_amount) > 0 && (
                  <div className="pos-total-row">
                    <span className="muted">ภาษี {sale.tax_rate}%</span>
                    <span>{baht(sale.tax_amount)}</span>
                  </div>
                )}
                <div className="pos-total-row grand">
                  <span>ยอดสุทธิ</span>
                  <span>{baht(sale.total)}</span>
                </div>

                <button
                  className="btn primary block lg mt-3"
                  onClick={() => setPayOpen(true)}
                  disabled={busy || sale.items.length === 0}
                >
                  ชำระเงิน {baht(sale.total)}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      {/* ------------------------------ โมดอล ------------------------------ */}
      <NewBillModal
        open={newBillOpen}
        onClose={() => setNewBillOpen(false)}
        onCreate={createBill}
        customers={customers}
        barbers={barbers}
        tickets={tickets}
        busy={busy}
      />

      <DiscountModal
        open={discountOpen}
        sale={sale}
        onClose={() => setDiscountOpen(false)}
        onApply={async (payload) => {
          const r = await run(() => api.patch(`/pos/sales/${sale.id}`, payload));
          if (r) { setDiscountOpen(false); toast.success('ปรับส่วนลดแล้ว'); }
        }}
        busy={busy}
      />

      <PaymentModal
        open={payOpen}
        sale={sale}
        onClose={() => setPayOpen(false)}
        onPaid={afterPaid}
        toast={toast}
      />

      <VoidModal open={voidOpen} onClose={() => setVoidOpen(false)} onConfirm={voidBill} busy={busy} sale={sale} />

      <Modal
        open={!!receipt}
        title="ชำระเงินเรียบร้อย"
        onClose={() => setReceipt(null)}
        footer={(
          <>
            <button className="btn" onClick={() => setReceipt(null)}>ปิด</button>
            <button className="btn dark" onClick={() => window.print()}>🖨 พิมพ์ใบเสร็จ</button>
          </>
        )}
      >
        <Receipt sale={receipt?.sale} shop={receipt?.shop} />
      </Modal>

      <OpenShiftModal
        open={openShiftModal}
        onClose={() => setOpenShiftModal(false)}
        onDone={(s) => { setShift(s); setOpenShiftModal(false); toast.success('เปิดกะเรียบร้อยแล้ว'); }}
        toast={toast}
        user={user}
      />
    </div>
  );
}

/* ==================================================================== */
/*  เปิดบิลใหม่                                                          */
/* ==================================================================== */
function NewBillModal({ open, onClose, onCreate, customers, barbers, tickets, busy }) {
  const [mode, setMode] = useState('walkin');
  const [customerId, setCustomerId] = useState('');
  const [guestName, setGuestName] = useState('');
  const [guestPhone, setGuestPhone] = useState('');
  const [ticketId, setTicketId] = useState('');
  const [barberId, setBarberId] = useState('');

  useEffect(() => {
    if (!open) return;
    setMode(tickets.length ? 'ticket' : 'walkin');
    setCustomerId(''); setGuestName(''); setGuestPhone(''); setTicketId(''); setBarberId('');
  }, [open, tickets.length]);

  const submit = () => {
    if (mode === 'ticket') {
      if (!ticketId) return;
      onCreate({ ticket_id: Number(ticketId) });
    } else if (mode === 'member') {
      if (!customerId) return;
      onCreate({ customer_id: Number(customerId), barber_id: barberId ? Number(barberId) : undefined });
    } else {
      onCreate({
        guest_name: guestName.trim() || 'ลูกค้าทั่วไป',
        guest_phone: guestPhone.trim() || undefined,
        barber_id: barberId ? Number(barberId) : undefined,
      });
    }
  };

  return (
    <Modal
      open={open}
      title="เปิดบิลใหม่"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}เปิดบิล
          </button>
        </>
      )}
    >
      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${mode === 'ticket' ? 'active' : ''}`} onClick={() => setMode('ticket')}>
          จากคิว ({tickets.length})
        </button>
        <button className={`chip ${mode === 'member' ? 'active' : ''}`} onClick={() => setMode('member')}>สมาชิก</button>
        <button className={`chip ${mode === 'walkin' ? 'active' : ''}`} onClick={() => setMode('walkin')}>ลูกค้าทั่วไป</button>
      </div>

      {mode === 'ticket' && (
        tickets.length === 0 ? (
          <Alert kind="info">ตอนนี้ไม่มีคิวที่เรียกแล้วหรือกำลังให้บริการ ลองเลือกโหมดอื่นแทน</Alert>
        ) : (
          <Field label="เลือกคิวที่จะเปิดบิล" hint="ระบบจะใส่ค่าบริการของคิวนั้นให้อัตโนมัติ และปิดคิวให้เมื่อชำระเงินเสร็จ">
            <select className="select" value={ticketId} onChange={(e) => setTicketId(e.target.value)}>
              <option value="">— เลือกคิว —</option>
              {tickets.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.ticket_no} · {t.customer_name} · {t.service_name} ({baht(t.price)})
                </option>
              ))}
            </select>
          </Field>
        )
      )}

      {mode === 'member' && (
        <Field label="เลือกลูกค้าสมาชิก" hint="ลูกค้าสมาชิกจะได้สะสมแต้มและใช้แต้มเป็นส่วนลดได้">
          <select className="select" value={customerId} onChange={(e) => setCustomerId(e.target.value)}>
            <option value="">— เลือกลูกค้า —</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}{c.phone ? ` · ${c.phone}` : ''}
                {c.loyalty_points ? ` · ${c.loyalty_points} แต้ม` : ''}
              </option>
            ))}
          </select>
        </Field>
      )}

      {mode === 'walkin' && (
        <>
          <Field label="ชื่อลูกค้า (ถ้ามี)">
            <input className="input" value={guestName} onChange={(e) => setGuestName(e.target.value)} placeholder="ลูกค้าทั่วไป" />
          </Field>
          <Field label="เบอร์โทรศัพท์ (ถ้ามี)">
            <input className="input" value={guestPhone} onChange={(e) => setGuestPhone(e.target.value)} placeholder="08x-xxx-xxxx" />
          </Field>
        </>
      )}

      {mode !== 'ticket' && (
        <Field label="ช่างผู้ให้บริการ (ถ้ามี)">
          <select className="select" value={barberId} onChange={(e) => setBarberId(e.target.value)}>
            <option value="">— ไม่ระบุ —</option>
            {barbers.map((b) => <option key={b.id} value={b.id}>{b.full_name} ({b.code})</option>)}
          </select>
        </Field>
      )}
    </Modal>
  );
}

/* ==================================================================== */
/*  ส่วนลด / โค้ด / แต้ม                                                 */
/* ==================================================================== */
function DiscountModal({ open, sale, onClose, onApply, busy }) {
  const [type, setType] = useState('');
  const [value, setValue] = useState('');
  const [promo, setPromo] = useState('');
  const [points, setPoints] = useState('');
  const [loyalty, setLoyalty] = useState(null);

  useEffect(() => {
    if (!open || !sale) return;
    setType(sale.discount_type || '');
    setValue(sale.discount_value ? String(sale.discount_value) : '');
    setPromo(sale.promo_code || '');
    setPoints(sale.points_used ? String(sale.points_used) : '');
    setLoyalty(null);

    if (sale.customer_id) {
      api.get(`/loyalty/${sale.customer_id}`).then(setLoyalty).catch(() => setLoyalty(null));
    }
  }, [open, sale]);

  if (!sale) return null;

  return (
    <Modal
      open={open}
      title="ส่วนลดและแต้มสะสม"
      onClose={onClose}
      footer={(
        <>
          <button
            className="btn"
            onClick={() => onApply({ discount_type: null, discount_value: 0, promo_code: null, points_used: 0 })}
            disabled={busy}
          >
            ล้างส่วนลด
          </button>
          <button
            className="btn primary"
            onClick={() => onApply({
              ...(promo.trim()
                ? { promo_code: promo.trim().toUpperCase() }
                : { promo_code: null, discount_type: type || null, discount_value: Number(value) || 0 }),
              points_used: Number(points) || 0,
            })}
            disabled={busy}
          >
            {busy && <span className="spinner" />}ใช้ส่วนลด
          </button>
        </>
      )}
    >
      <Field label="โค้ดส่วนลด" hint="ใส่โค้ดแล้วระบบจะคำนวณส่วนลดให้เอง (ทับส่วนลดที่กรอกเอง)">
        <input
          className="input"
          value={promo}
          onChange={(e) => setPromo(e.target.value.toUpperCase())}
          placeholder="เช่น MEMBER10"
        />
      </Field>

      <div className="divider">หรือกำหนดส่วนลดเอง</div>

      <div className="row gap-2">
        <Field label="ชนิด">
          <select className="select" value={type} onChange={(e) => setType(e.target.value)} disabled={!!promo.trim()}>
            <option value="">ไม่ลด</option>
            <option value="amount">ลดเป็นบาท</option>
            <option value="percent">ลดเป็น %</option>
          </select>
        </Field>
        <Field label="จำนวน">
          <input
            className="input"
            type="number"
            min="0"
            value={value}
            onChange={(e) => setValue(e.target.value)}
            disabled={!type || !!promo.trim()}
          />
        </Field>
      </div>

      {sale.customer_id ? (
        <>
          <div className="divider">แต้มสะสม</div>
          {loyalty ? (
            <>
              <div className="dl" style={{ marginBottom: 12 }}>
                <dt>แต้มคงเหลือ</dt><dd>{loyalty.user.loyalty_points} แต้ม</dd>
                <dt>ใช้แทนเงินได้</dt><dd>{baht(loyalty.redeemable_baht)}</dd>
                <dt>ใช้ขั้นต่ำ</dt><dd>{loyalty.config.minRedeem} แต้ม</dd>
              </div>
              <Field
                label="ใช้แต้มในบิลนี้"
                hint={loyalty.can_redeem
                  ? `1 แต้ม = ${baht(loyalty.config.pointValueBaht)}`
                  : `ต้องมีอย่างน้อย ${loyalty.config.minRedeem} แต้มจึงจะใช้ได้`}
              >
                <input
                  className="input"
                  type="number"
                  min="0"
                  max={loyalty.user.loyalty_points}
                  value={points}
                  onChange={(e) => setPoints(e.target.value)}
                  disabled={!loyalty.can_redeem}
                />
              </Field>
            </>
          ) : <Loading rows={2} />}
        </>
      ) : (
        <Alert kind="info">บิลนี้ไม่ได้ระบุลูกค้าสมาชิก จึงใช้แต้มสะสมไม่ได้</Alert>
      )}
    </Modal>
  );
}

/* ==================================================================== */
/*  ชำระเงิน                                                             */
/* ==================================================================== */
function PaymentModal({ open, sale, onClose, onPaid, toast }) {
  const [rows, setRows] = useState([]);
  const [busy, setBusy] = useState(false);

  const total = Number(sale?.total || 0);
  const paid = round2(rows.reduce((s, r) => s + (Number(r.amount) || 0), 0));
  const remaining = round2(Math.max(total - paid, 0));
  const change = round2(Math.max(paid - total, 0));

  useEffect(() => {
    if (open) setRows([{ method: 'cash', amount: String(total) }]);
  }, [open, total]);

  if (!sale) return null;

  const setRow = (i, patch) => setRows((rs) => rs.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  const addRow = () => setRows((rs) => [...rs, { method: 'promptpay', amount: String(remaining || '') }]);
  const removeRow = (i) => setRows((rs) => rs.filter((_, idx) => idx !== i));

  const addCash = (amount) => setRows((rs) => {
    const i = rs.findIndex((r) => r.method === 'cash');
    if (i < 0) return [...rs, { method: 'cash', amount: String(amount) }];
    return rs.map((r, idx) => (idx === i ? { ...r, amount: String(round2((Number(r.amount) || 0) + amount)) } : r));
  });

  const submit = async () => {
    setBusy(true);
    try {
      const payments = rows
        .filter((r) => Number(r.amount) > 0)
        .map((r) => ({
          method: r.method,
          amount: Number(r.amount),
          ...(r.method === 'cash' ? { received: Number(r.amount) } : {}),
          ...(r.reference ? { reference: r.reference } : {}),
        }));

      const result = await api.post(`/pos/sales/${sale.id}/checkout`, { payments });
      toast.success(result.message);
      onPaid(result.sale);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      wide
      title={`ชำระเงิน · ${sale.bill_no}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy || paid + 0.009 < total}>
            {busy && <span className="spinner" />}
            ยืนยันรับเงิน {baht(paid)}
          </button>
        </>
      )}
    >
      <div className="grid grid-2" style={{ gap: 20 }}>
        <div>
          <div className="pos-total-row grand" style={{ marginTop: 0, borderTop: 'none', paddingTop: 0 }}>
            <span>ต้องชำระ</span>
            <span>{baht(total)}</span>
          </div>
          <div className="pos-total-row">
            <span className="muted">รับมาแล้ว</span>
            <span>{baht(paid)}</span>
          </div>
          <div className="pos-total-row">
            <span className="muted">{remaining > 0 ? 'ยังขาดอีก' : 'เงินทอน'}</span>
            <span style={{ color: remaining > 0 ? 'var(--brand)' : 'var(--ok)', fontWeight: 700 }}>
              {baht(remaining > 0 ? remaining : change)}
            </span>
          </div>

          <div className="divider">เพิ่มเงินสดเร็ว ๆ</div>
          <div className="cash-quick">
            {QUICK_CASH.map((n) => (
              <button key={n} className="btn sm" onClick={() => addCash(n)}>+{n}</button>
            ))}
            <button className="btn sm" onClick={() => addCash(remaining)} disabled={remaining <= 0}>พอดี</button>
          </div>
          <div className="cash-pad">
            {[1000, 500, 100].map((n) => (
              <button key={n} onClick={() => addCash(n)}>{n.toLocaleString('th-TH')}</button>
            ))}
            {[50, 20, 10].map((n) => (
              <button key={n} onClick={() => addCash(n)}>{n}</button>
            ))}
          </div>
          <button className="btn block mt-3" onClick={() => setRows([{ method: 'cash', amount: '' }])}>ล้างทั้งหมด</button>
        </div>

        <div>
          <div className="bold small" style={{ marginBottom: 8 }}>วิธีชำระเงิน</div>
          {rows.map((r, i) => (
            <div key={i} className="card" style={{ marginBottom: 10 }}>
              <div className="card-body tight col gap-2">
                <div className="pay-method-grid">
                  {METHODS.map((m) => (
                    <button
                      key={m.key}
                      className={`pay-method ${r.method === m.key ? 'active' : ''}`}
                      onClick={() => setRow(i, { method: m.key })}
                    >
                      <span className="ic">{m.ic}</span>
                      <span>{m.label}</span>
                    </button>
                  ))}
                </div>
                <div className="row gap-2">
                  <input
                    className="input"
                    type="number"
                    min="0"
                    step="0.01"
                    value={r.amount}
                    onChange={(e) => setRow(i, { amount: e.target.value })}
                    placeholder="จำนวนเงิน"
                  />
                  {rows.length > 1 && (
                    <button className="btn ghost" onClick={() => removeRow(i)} title="ลบรายการนี้">✕</button>
                  )}
                </div>
                {r.method !== 'cash' && (
                  <input
                    className="input"
                    value={r.reference || ''}
                    onChange={(e) => setRow(i, { reference: e.target.value })}
                    placeholder="เลขอ้างอิง / เลขอนุมัติ (ถ้ามี)"
                  />
                )}
              </div>
            </div>
          ))}
          <button className="btn block" onClick={addRow}>+ แยกจ่ายหลายวิธี</button>
        </div>
      </div>
    </Modal>
  );
}

/* ==================================================================== */
/*  ยกเลิกบิล / เปิดกะ                                                   */
/* ==================================================================== */
function VoidModal({ open, onClose, onConfirm, busy, sale }) {
  const [reason, setReason] = useState('');
  useEffect(() => { if (open) setReason(''); }, [open]);

  return (
    <Modal
      open={open}
      title="ยกเลิกบิล"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ไม่ยกเลิก</button>
          <button className="btn primary" onClick={() => onConfirm(reason)} disabled={busy}>
            {busy && <span className="spinner" />}ยืนยันยกเลิกบิล
          </button>
        </>
      )}
    >
      <p className="mt-1">
        ยกเลิกบิล <strong>{sale?.bill_no}</strong> ที่มี {sale?.items?.length || 0} รายการ ยอด {baht(sale?.total)} ใช่ไหม
      </p>
      <Field label="เหตุผล (ถ้ามี)">
        <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="เช่น ลูกค้าเปลี่ยนใจ" />
      </Field>
    </Modal>
  );
}

function OpenShiftModal({ open, onClose, onDone, toast }) {
  const [float, setFloat] = useState('1000');
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post('/shifts/open', { opening_float: Number(float) || 0 });
      onDone(r.shift);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      title="เปิดกะ"
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy}>
            {busy && <span className="spinner" />}เปิดกะ
          </button>
        </>
      )}
    >
      <Field label="เงินทอนตั้งต้นในลิ้นชัก (บาท)" hint="ตอนปิดกะ ระบบจะเทียบเงินที่นับได้กับยอดนี้ให้">
        <input className="input" type="number" min="0" value={float} onChange={(e) => setFloat(e.target.value)} />
      </Field>
    </Modal>
  );
}
