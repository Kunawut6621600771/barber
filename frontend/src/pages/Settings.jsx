import { useCallback, useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, Modal, ConfirmModal, Field, Empty, Loading, Switch, Alert, baht, dateOf,
} from '../components/ui.jsx';

const GROUPS = [
  {
    title: 'ข้อมูลร้าน',
    hint: 'แสดงบนใบเสร็จ หน้าเว็บ และใน LINE Bot',
    keys: ['shop_name', 'shop_tagline', 'shop_phone', 'shop_address', 'shop_map_url'],
  },
  {
    title: 'เวลาทำการ',
    hint: 'ใช้กำหนดช่วงเวลาที่จองล่วงหน้าได้ และคำตอบของ LINE Bot',
    keys: ['open_time', 'close_time', 'open_days'],
  },
  {
    title: 'คิว',
    hint: 'รูปแบบเลขคิวและเกณฑ์แจ้งเตือนลูกค้า',
    keys: ['ticket_prefix', 'near_turn_threshold'],
  },
  {
    title: 'ใบเสร็จและภาษี',
    hint: 'ตั้ง tax_rate เป็น 0 ถ้าร้านไม่คิด VAT',
    keys: ['tax_rate', 'tax_id', 'receipt_footer'],
  },
  {
    title: 'สมาชิกและแต้มสะสม',
    hint: 'points_per_baht = 0.05 หมายถึงใช้จ่าย 20 บาทได้ 1 แต้ม',
    keys: ['loyalty_enabled', 'points_per_baht', 'point_value_baht', 'min_points_redeem'],
  },
  {
    title: 'การจองล่วงหน้า',
    hint: 'ปิดได้ถ้าร้านรับเฉพาะ walk-in',
    keys: ['booking_enabled', 'booking_slot_min', 'booking_max_days'],
  },
];

export default function Settings() {
  const toast = useToast();
  const { user } = useAuth();
  const isAdmin = user.role === 'admin';

  const [tab, setTab] = useState('shop');
  const [fields, setFields] = useState([]);
  const [values, setValues] = useState({});
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [errors, setErrors] = useState({});

  const load = useCallback(async () => {
    try {
      const d = await api.get('/settings');
      setFields(d.fields);
      setValues(Object.fromEntries(d.fields.map((f) => [f.key, f.value])));
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      toast.success((await api.put('/settings', { settings: values })).message);
      load();
    } catch (err) {
      setErrors(err.details || {});
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const fieldOf = (key) => fields.find((f) => f.key === key);

  if (loading) return <div className="page"><Loading rows={6} /></div>;

  return (
    <div className="page">
      <div className="page-head row-between wrap">
        <div>
          <h1>ตั้งค่าร้าน</h1>
          <div className="sub">ค่าทั้งหมดนี้มีผลทันทีกับหน้าเว็บ ใบเสร็จ และ LINE Bot</div>
        </div>
        {tab === 'shop' && isAdmin && (
          <button className="btn primary" onClick={save} disabled={busy}>
            {busy && <span className="spinner" />}บันทึกการตั้งค่า
          </button>
        )}
      </div>

      <div className="chips" style={{ marginBottom: 16 }}>
        <button className={`chip ${tab === 'shop' ? 'active' : ''}`} onClick={() => setTab('shop')}>⚙ ตั้งค่าทั่วไป</button>
        <button className={`chip ${tab === 'promo' ? 'active' : ''}`} onClick={() => setTab('promo')}>🏷 โค้ดส่วนลด</button>
      </div>

      {!isAdmin && <Alert kind="info">คุณดูค่าตั้งค่าได้ แต่แก้ไขได้เฉพาะผู้ดูแลระบบ</Alert>}

      {tab === 'shop' ? (
        <div className="grid grid-2">
          {GROUPS.map((g) => (
            <Card key={g.title} title={g.title} subtitle={g.hint}>
              {g.keys.map((key) => {
                const f = fieldOf(key);
                if (!f) return null;
                return (
                  <Field key={key} label={f.label} error={errors[key]} hint={f.description}>
                    {f.type === 'bool' ? (
                      <div className="row gap-2" style={{ height: 40 }}>
                        <Switch
                          checked={values[key] === 'true'}
                          onChange={(v) => setValues({ ...values, [key]: v ? 'true' : 'false' })}
                        />
                        <span className="small muted">{values[key] === 'true' ? 'เปิดใช้งาน' : 'ปิดอยู่'}</span>
                      </div>
                    ) : (
                      <input
                        className={`input ${errors[key] ? 'error' : ''}`}
                        type={f.type === 'number' ? 'number' : key.includes('time') ? 'time' : 'text'}
                        step={f.type === 'number' ? 'any' : undefined}
                        value={values[key] ?? ''}
                        onChange={(e) => setValues({ ...values, [key]: e.target.value })}
                        disabled={!isAdmin}
                      />
                    )}
                  </Field>
                );
              })}
            </Card>
          ))}
        </div>
      ) : (
        <PromoTab toast={toast} isAdmin={isAdmin} canEdit={['admin', 'staff'].includes(user.role)} />
      )}
    </div>
  );
}

/* ==================================================================== */
/*  โค้ดส่วนลด                                                           */
/* ==================================================================== */
const BLANK_PROMO = {
  code: '', description: '', discount_type: 'percent', discount_value: '10',
  min_total: '0', max_discount: '', max_uses: '', starts_at: '', ends_at: '', is_active: true,
};

function PromoTab({ toast, isAdmin, canEdit }) {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(BLANK_PROMO);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [removing, setRemoving] = useState(null);

  const load = useCallback(async () => {
    try {
      setList((await api.get('/pos/promos')).data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const openForm = (promo) => {
    setEditing(promo || 'new');
    setErrors({});
    setForm(promo ? {
      code: promo.code, description: promo.description || '',
      discount_type: promo.discount_type, discount_value: String(promo.discount_value),
      min_total: String(promo.min_total), max_discount: promo.max_discount ?? '',
      max_uses: promo.max_uses ?? '',
      starts_at: promo.starts_at ? String(promo.starts_at).slice(0, 10) : '',
      ends_at: promo.ends_at ? String(promo.ends_at).slice(0, 10) : '',
      is_active: promo.is_active,
    } : BLANK_PROMO);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        ...form,
        discount_value: Number(form.discount_value) || 0,
        min_total: Number(form.min_total) || 0,
        max_discount: form.max_discount === '' ? undefined : Number(form.max_discount),
        max_uses: form.max_uses === '' ? undefined : Number(form.max_uses),
        starts_at: form.starts_at || undefined,
        ends_at: form.ends_at || undefined,
      };
      const r = editing === 'new'
        ? await api.post('/pos/promos', payload)
        : await api.put(`/pos/promos/${editing.id}`, payload);
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
      toast.success((await api.del(`/pos/promos/${removing.id}`)).message);
      setRemoving(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Loading rows={4} />;

  return (
    <Card
      title="โค้ดส่วนลด"
      subtitle="พนักงานใส่โค้ดในหน้า POS แล้วระบบจะคำนวณส่วนลดให้เอง"
      action={canEdit && <button className="btn primary sm" onClick={() => openForm(null)}>+ สร้างโค้ด</button>}
      tight
    >
      {list.length === 0 ? (
        <Empty icon="🏷" title="ยังไม่มีโค้ดส่วนลด" hint="สร้างโค้ดแรกเพื่อใช้ในหน้า POS" />
      ) : (
        <div className="table-wrap">
          <table className="data">
            <thead>
              <tr>
                <th>โค้ด</th><th>ส่วนลด</th><th className="right">ยอดขั้นต่ำ</th>
                <th className="right">ใช้แล้ว</th><th>ช่วงเวลา</th><th>สถานะ</th><th />
              </tr>
            </thead>
            <tbody>
              {list.map((p) => (
                <tr key={p.id}>
                  <td>
                    <div className="bold mono">{p.code}</div>
                    {p.description && <div className="tiny muted">{p.description}</div>}
                  </td>
                  <td className="bold">
                    {p.discount_type === 'percent' ? `${p.discount_value}%` : baht(p.discount_value)}
                    {p.max_discount && <div className="tiny muted">สูงสุด {baht(p.max_discount)}</div>}
                  </td>
                  <td className="right mono">{Number(p.min_total) ? baht(p.min_total) : '—'}</td>
                  <td className="right mono">{p.used_count}{p.max_uses ? ` / ${p.max_uses}` : ''}</td>
                  <td className="tiny muted">
                    {p.starts_at || p.ends_at
                      ? `${p.starts_at ? dateOf(p.starts_at) : 'เริ่มทันที'} – ${p.ends_at ? dateOf(p.ends_at) : 'ไม่มีกำหนด'}`
                      : 'ตลอดเวลา'}
                  </td>
                  <td>
                    <span className={`badge ${p.is_active ? 'ok' : ''}`}>
                      <i className="dot-i" />{p.is_active ? 'ใช้ได้' : 'ปิดอยู่'}
                    </span>
                  </td>
                  <td>
                    <div className="actions">
                      {canEdit && <button className="btn sm" onClick={() => openForm(p)}>แก้ไข</button>}
                      {isAdmin && <button className="btn sm danger" onClick={() => setRemoving(p)}>ลบ</button>}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Modal
        open={!!editing}
        wide
        title={editing === 'new' ? 'สร้างโค้ดส่วนลด' : `แก้ไขโค้ด ${editing?.code || ''}`}
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
          <Field label="โค้ด" error={errors.code} hint="ตัวพิมพ์ใหญ่ ไม่มีช่องว่าง">
            <input
              className="input"
              value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase().replace(/\s/g, '') })}
            />
          </Field>
          <Field label="ชนิดส่วนลด" error={errors.discount_type}>
            <select className="select" value={form.discount_type} onChange={(e) => setForm({ ...form, discount_type: e.target.value })}>
              <option value="percent">ลดเป็นเปอร์เซ็นต์</option>
              <option value="amount">ลดเป็นบาท</option>
            </select>
          </Field>
          <Field label={form.discount_type === 'percent' ? 'ลดกี่ %' : 'ลดกี่บาท'} error={errors.discount_value}>
            <input className="input" type="number" min="0" value={form.discount_value} onChange={(e) => setForm({ ...form, discount_value: e.target.value })} />
          </Field>
          <Field label="ส่วนลดสูงสุด (บาท)" hint="เว้นว่างถ้าไม่จำกัด">
            <input className="input" type="number" min="0" value={form.max_discount} onChange={(e) => setForm({ ...form, max_discount: e.target.value })} />
          </Field>
          <Field label="ยอดขั้นต่ำ (บาท)">
            <input className="input" type="number" min="0" value={form.min_total} onChange={(e) => setForm({ ...form, min_total: e.target.value })} />
          </Field>
          <Field label="ใช้ได้กี่ครั้ง" hint="เว้นว่างถ้าไม่จำกัด">
            <input className="input" type="number" min="1" value={form.max_uses} onChange={(e) => setForm({ ...form, max_uses: e.target.value })} />
          </Field>
          <Field label="เริ่มใช้ได้">
            <input className="input" type="date" value={form.starts_at} onChange={(e) => setForm({ ...form, starts_at: e.target.value })} />
          </Field>
          <Field label="ใช้ได้ถึง">
            <input className="input" type="date" value={form.ends_at} onChange={(e) => setForm({ ...form, ends_at: e.target.value })} />
          </Field>
        </div>

        <Field label="คำอธิบาย" hint="ข้อความนี้จะแสดงใน LINE Bot เมื่อลูกค้าถามโปรโมชัน">
          <input className="input" value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </Field>

        <label className="row gap-2">
          <Switch checked={form.is_active} onChange={(v) => setForm({ ...form, is_active: v })} />
          <span className="small">เปิดให้ใช้โค้ดนี้</span>
        </label>
      </Modal>

      <ConfirmModal
        open={!!removing}
        title="ลบโค้ดส่วนลด"
        message={`ลบโค้ด "${removing?.code}" ใช่ไหม บิลเก่าที่เคยใช้โค้ดนี้จะไม่ได้รับผลกระทบ`}
        confirmText="ลบโค้ด"
        danger
        busy={busy}
        onConfirm={remove}
        onClose={() => setRemoving(null)}
      />
    </Card>
  );
}
