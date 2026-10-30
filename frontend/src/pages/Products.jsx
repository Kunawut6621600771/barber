import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, Modal, ConfirmModal, Field, Empty, Loading, Switch, Stat, baht, dateTimeOf,
} from '../components/ui.jsx';

const BLANK = {
  sku: '', name: '', category: 'ทั่วไป', description: '',
  cost_price: '', price: '', stock_qty: '0', low_stock_level: '5',
  track_stock: true, is_active: true,
};

const MOVE_LABEL = {
  sale: 'ขาย', restock: 'รับเข้า', adjust: 'ปรับยอด',
  refund: 'คืนสินค้า', void: 'ยกเลิกบิล', damage: 'ของเสีย',
};

export default function Products() {
  const toast = useToast();
  const { user } = useAuth();
  const canEdit = ['admin', 'staff'].includes(user.role);

  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [onlyLow, setOnlyLow] = useState(false);

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [stockFor, setStockFor] = useState(null);
  const [removing, setRemoving] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      setItems((await api.get('/products')).data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const categories = useMemo(
    () => [...new Set(items.map((i) => i.category).filter(Boolean))].sort(),
    [items],
  );

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return items.filter((i) => (!category || i.category === category)
      && (!onlyLow || i.is_low_stock)
      && (!q || i.name.toLowerCase().includes(q) || (i.sku || '').toLowerCase().includes(q)));
  }, [items, search, category, onlyLow]);

  const summary = useMemo(() => {
    const active = items.filter((i) => i.is_active);
    return {
      count: active.length,
      units: active.reduce((s, i) => s + (i.track_stock ? i.stock_qty : 0), 0),
      cost: active.reduce((s, i) => s + (i.track_stock ? i.stock_qty * Number(i.cost_price) : 0), 0),
      retail: active.reduce((s, i) => s + (i.track_stock ? i.stock_qty * Number(i.price) : 0), 0),
      low: active.filter((i) => i.is_low_stock).length,
    };
  }, [items]);

  const openForm = (product) => {
    setEditing(product || 'new');
    setErrors({});
    setForm(product ? {
      sku: product.sku || '', name: product.name, category: product.category,
      description: product.description || '', cost_price: String(product.cost_price),
      price: String(product.price), stock_qty: String(product.stock_qty),
      low_stock_level: String(product.low_stock_level),
      track_stock: product.track_stock, is_active: product.is_active,
    } : BLANK);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        ...form,
        cost_price: Number(form.cost_price) || 0,
        price: Number(form.price) || 0,
        stock_qty: Number(form.stock_qty) || 0,
        low_stock_level: Number(form.low_stock_level) || 0,
      };
      const r = editing === 'new'
        ? await api.post('/products', payload)
        : await api.put(`/products/${editing.id}`, payload);
      toast.success(r.message);
      setEditing(null);
      load();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      toast.success((await api.del(`/products/${removing.id}`)).message);
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const showDetail = async (product) => {
    try {
      setDetail(await api.get(`/products/${product.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="page"><Loading rows={6} /></div>;

  return (
    <div className="page">
      <div className="page-head row-between wrap">
        <div>
          <h1>สินค้าและสต็อก</h1>
          <div className="sub">สินค้าที่ขายหน้าร้าน ตัดสต็อกอัตโนมัติเมื่อชำระเงินในหน้า POS</div>
        </div>
        {canEdit && <button className="btn primary" onClick={() => openForm(null)}>+ เพิ่มสินค้า</button>}
      </div>

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <Stat label="สินค้าที่เปิดขาย" value={summary.count} unit="รายการ" icon="🧴" />
        <Stat label="จำนวนคงเหลือรวม" value={summary.units.toLocaleString('th-TH')} unit="ชิ้น" icon="📦" />
        <Stat label="มูลค่าต้นทุน" value={baht(summary.cost)} icon="💰" />
        <Stat label="มูลค่าขาย" value={baht(summary.retail)} icon="🏷" />
        <Stat
          label="ใกล้หมด"
          value={summary.low}
          unit="รายการ"
          icon="⚠"
          tone={summary.low ? 'var(--brand)' : undefined}
        />
      </div>

      <Card tight>
        <div className="row gap-2 wrap" style={{ marginBottom: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="ค้นหาชื่อหรือ SKU..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chips">
            <button className={`chip ${!category ? 'active' : ''}`} onClick={() => setCategory('')}>ทุกหมวด</button>
            {categories.map((c) => (
              <button key={c} className={`chip ${category === c ? 'active' : ''}`} onClick={() => setCategory(c)}>{c}</button>
            ))}
            <button className={`chip ${onlyLow ? 'active' : ''}`} onClick={() => setOnlyLow((v) => !v)}>⚠ ใกล้หมด</button>
          </div>
        </div>

        {shown.length === 0 ? (
          <Empty icon="📦" title="ไม่พบสินค้า" hint="ลองเปลี่ยนคำค้น หรือเพิ่มสินค้าใหม่" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>สินค้า</th>
                  <th>หมวด</th>
                  <th className="right">ทุน</th>
                  <th className="right">ราคาขาย</th>
                  <th className="right">กำไร/ชิ้น</th>
                  <th className="right">คงเหลือ</th>
                  <th>สถานะ</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {shown.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <button className="btn ghost sm" style={{ padding: 0, height: 'auto' }} onClick={() => showDetail(p)}>
                        <div style={{ textAlign: 'left' }}>
                          <div className="bold">{p.name}</div>
                          {p.sku && <div className="tiny muted">{p.sku}</div>}
                        </div>
                      </button>
                    </td>
                    <td>{p.category}</td>
                    <td className="right mono">{baht(p.cost_price)}</td>
                    <td className="right mono bold">{baht(p.price)}</td>
                    <td className="right mono" style={{ color: 'var(--ok)' }}>
                      {baht(Number(p.price) - Number(p.cost_price))}
                    </td>
                    <td className="right mono">
                      {p.track_stock
                        ? <span className={p.is_low_stock ? 'badge warn' : ''}>{p.stock_qty}</span>
                        : <span className="muted tiny">ไม่ตัดสต็อก</span>}
                    </td>
                    <td>
                      <span className={`badge ${p.is_active ? 'ok' : ''}`}>
                        <i className="dot-i" />{p.is_active ? 'เปิดขาย' : 'ปิดขาย'}
                      </span>
                    </td>
                    <td>
                      <div className="actions">
                        {canEdit && p.track_stock && (
                          <button className="btn sm" onClick={() => setStockFor(p)}>สต็อก</button>
                        )}
                        {canEdit && <button className="btn sm" onClick={() => openForm(p)}>แก้ไข</button>}
                        {user.role === 'admin' && (
                          <button className="btn sm danger" onClick={() => setRemoving(p)}>ลบ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {/* ---------------------------- ฟอร์มสินค้า ---------------------------- */}
      <Modal
        open={!!editing}
        wide
        title={editing === 'new' ? 'เพิ่มสินค้า' : `แก้ไข: ${editing?.name || ''}`}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button className="btn" onClick={() => setEditing(null)} disabled={busy}>ยกเลิก</button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy && <span className="spinner" />}บันทึก
            </button>
          </>
        )}
      >
        <div className="grid grid-2">
          <Field label="ชื่อสินค้า" error={errors.name}>
            <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </Field>
          <Field label="รหัสสินค้า (SKU)" error={errors.sku} hint="ไม่ใส่ก็ได้ แต่ช่วยให้ค้นหาเร็วขึ้น">
            <input className="input" value={form.sku} onChange={(e) => setForm({ ...form, sku: e.target.value })} />
          </Field>
          <Field label="หมวดหมู่" error={errors.category}>
            <input
              className="input"
              list="product-categories"
              value={form.category}
              onChange={(e) => setForm({ ...form, category: e.target.value })}
            />
            <datalist id="product-categories">
              {categories.map((c) => <option key={c} value={c} />)}
            </datalist>
          </Field>
          <Field label="ราคาขาย (บาท)" error={errors.price}>
            <input
              className="input" type="number" min="0" step="0.01"
              value={form.price} onChange={(e) => setForm({ ...form, price: e.target.value })}
            />
          </Field>
          <Field label="ราคาทุน (บาท)" error={errors.cost_price} hint="ใช้คำนวณกำไรในรายงาน">
            <input
              className="input" type="number" min="0" step="0.01"
              value={form.cost_price} onChange={(e) => setForm({ ...form, cost_price: e.target.value })}
            />
          </Field>
          <Field label="จุดเตือนสต็อกต่ำ" error={errors.low_stock_level}>
            <input
              className="input" type="number" min="0"
              value={form.low_stock_level} onChange={(e) => setForm({ ...form, low_stock_level: e.target.value })}
            />
          </Field>
          {editing === 'new' && (
            <Field label="จำนวนตั้งต้น" error={errors.stock_qty}>
              <input
                className="input" type="number" min="0"
                value={form.stock_qty} onChange={(e) => setForm({ ...form, stock_qty: e.target.value })}
              />
            </Field>
          )}
        </div>

        <Field label="รายละเอียด">
          <textarea
            className="textarea"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
        </Field>

        <div className="row gap-4 wrap">
          <label className="row gap-2">
            <Switch checked={form.track_stock} onChange={(v) => setForm({ ...form, track_stock: v })} />
            <span className="small">ตัดสต็อกเมื่อขาย</span>
          </label>
          <label className="row gap-2">
            <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
            <span className="small">เปิดขายในหน้า POS</span>
          </label>
        </div>
      </Modal>

      <StockModal
        product={stockFor}
        onClose={() => setStockFor(null)}
        onDone={() => { setStockFor(null); load(); }}
        toast={toast}
      />

      <ConfirmModal
        open={!!removing}
        title="ลบสินค้า"
        message={`ลบ "${removing?.name}" ใช่ไหม ถ้าสินค้านี้เคยถูกขายไปแล้ว ระบบจะปิดการขายแทนการลบเพื่อให้ใบเสร็จเก่ายังอ้างอิงได้`}
        confirmText="ลบสินค้า"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />

      <Modal
        open={!!detail}
        wide
        title={detail?.product?.name || ''}
        onClose={() => setDetail(null)}
        footer={<button className="btn dark" onClick={() => setDetail(null)}>ปิด</button>}
      >
        {detail && (
          <>
            <div className="dl" style={{ marginBottom: 16 }}>
              <dt>รหัสสินค้า</dt><dd>{detail.product.sku || '—'}</dd>
              <dt>หมวดหมู่</dt><dd>{detail.product.category}</dd>
              <dt>ราคาขาย</dt><dd>{baht(detail.product.price)}</dd>
              <dt>ราคาทุน</dt><dd>{baht(detail.product.cost_price)}</dd>
              <dt>คงเหลือ</dt><dd>{detail.product.track_stock ? `${detail.product.stock_qty} ชิ้น` : 'ไม่ตัดสต็อก'}</dd>
            </div>
            {detail.product.description && <p className="small muted mt-2">{detail.product.description}</p>}

            <div className="divider">ประวัติสต็อกล่าสุด</div>
            {detail.movements.length === 0 ? (
              <Empty icon="📋" title="ยังไม่มีการเคลื่อนไหว" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>เวลา</th><th>ประเภท</th><th className="right">เปลี่ยน</th><th className="right">คงเหลือ</th><th>หมายเหตุ</th></tr>
                  </thead>
                  <tbody>
                    {detail.movements.map((m) => (
                      <tr key={m.id}>
                        <td className="tiny">{dateTimeOf(m.created_at)}</td>
                        <td><span className="badge">{MOVE_LABEL[m.reason] || m.reason}</span></td>
                        <td className="right mono bold" style={{ color: m.change_qty > 0 ? 'var(--ok)' : 'var(--brand)' }}>
                          {m.change_qty > 0 ? '+' : ''}{m.change_qty}
                        </td>
                        <td className="right mono">{m.balance_after}</td>
                        <td className="tiny muted">{m.note || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

/* ------------------------- ปรับสต็อก ------------------------- */
function StockModal({ product, onClose, onDone, toast }) {
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('restock');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (product) { setQty(''); setReason('restock'); setNote(''); }
  }, [product]);

  if (!product) return null;

  const n = Number(qty) || 0;
  const signed = reason === 'restock' ? Math.abs(n) : reason === 'damage' ? -Math.abs(n) : n;
  const after = product.stock_qty + signed;

  const submit = async () => {
    setBusy(true);
    try {
      const r = await api.post(`/products/${product.id}/stock`, {
        change_qty: signed, reason, note: note || undefined,
      });
      toast.success(r.message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`ปรับสต็อก: ${product.name}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy || signed === 0 || after < 0}>
            {busy && <span className="spinner" />}บันทึก
          </button>
        </>
      )}
    >
      <div className="dl" style={{ marginBottom: 14 }}>
        <dt>คงเหลือตอนนี้</dt><dd>{product.stock_qty} ชิ้น</dd>
        <dt>หลังปรับ</dt>
        <dd style={{ color: after < 0 ? 'var(--brand)' : 'var(--ok)' }}>{after} ชิ้น</dd>
      </div>

      <Field label="ประเภทการปรับ">
        <select className="select" value={reason} onChange={(e) => setReason(e.target.value)}>
          <option value="restock">รับสินค้าเข้า (+)</option>
          <option value="damage">ตัดของเสีย (−)</option>
          <option value="adjust">ปรับยอดตามที่นับได้ (+/−)</option>
        </select>
      </Field>

      <Field
        label="จำนวน"
        hint={reason === 'adjust' ? 'ใส่ค่าลบเพื่อลดจำนวน เช่น -3' : 'ใส่จำนวนที่ต้องการ'}
      >
        <input className="input" type="number" value={qty} onChange={(e) => setQty(e.target.value)} />
      </Field>

      <Field label="หมายเหตุ">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น รับของจากซัพพลายเออร์ A" />
      </Field>
    </Modal>
  );
}
