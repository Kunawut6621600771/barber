import { useState, useEffect, useCallback, useMemo } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth, isStaffRole } from '../context/AuthContext.jsx';
import {
  Card, Stat, Empty, Loading, Modal, ConfirmModal, Field, Switch, baht,
} from '../components/ui.jsx';

const ICONS = { 'ตัดผม': '✂', 'สระผม': '🧴', 'โกนหนวด': '🪒', 'ทำสีผม': '🎨' };
const emptyForm = { name: '', category_id: '', description: '', duration_min: 30, price: 200, is_active: true };

export default function Services() {
  const toast = useToast();
  const { user } = useAuth();
  const [params] = useSearchParams();
  const canEdit = ['admin', 'staff'].includes(user.role);
  const staff = isStaffRole(user.role);

  const [services, setServices] = useState([]);
  const [categories, setCategories] = useState([]);
  const [loading, setLoading] = useState(true);
  const [categoryFilter, setCategoryFilter] = useState('');
  const [search, setSearch] = useState(params.get('q') || '');

  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [catOpen, setCatOpen] = useState(false);

  const load = useCallback(async () => {
    try {
      const [s, c] = await Promise.all([api.get('/services'), api.get('/services/categories')]);
      setServices(s.data);
      setCategories(c.data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => services.filter((s) => {
    if (categoryFilter && String(s.category_id) !== categoryFilter) return false;
    if (search && !s.name.toLowerCase().includes(search.toLowerCase())) return false;
    if (!staff && !s.is_active) return false;      // ลูกค้าเห็นเฉพาะบริการที่เปิดใช้งาน
    return true;
  }), [services, categoryFilter, search, staff]);

  const stats = useMemo(() => {
    const active = services.filter((s) => s.is_active);
    return {
      total: active.length,
      categories: categories.length,
      avgPrice: active.length ? active.reduce((a, s) => a + Number(s.price), 0) / active.length : 0,
      avgDuration: active.length ? active.reduce((a, s) => a + s.duration_min, 0) / active.length : 0,
    };
  }, [services, categories]);

  const openCreate = () => { setForm({ ...emptyForm, category_id: categories[0]?.id ?? '' }); setErrors({}); setEditing({}); };
  const openEdit = (s) => {
    setForm({
      name: s.name, category_id: s.category_id ?? '', description: s.description || '',
      duration_min: s.duration_min, price: Number(s.price), is_active: s.is_active,
    });
    setErrors({});
    setEditing(s);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = {
        name: form.name,
        description: form.description,
        duration_min: Number(form.duration_min),
        price: Number(form.price),
        is_active: form.is_active,
        ...(form.category_id ? { category_id: Number(form.category_id) } : {}),
      };
      if (editing.id) {
        await api.put(`/services/${editing.id}`, payload);
        toast.ok('แก้ไขบริการเรียบร้อยแล้ว');
      } else {
        await api.post('/services', payload);
        toast.ok('เพิ่มบริการใหม่เรียบร้อยแล้ว');
      }
      setEditing(null);
      load();
    } catch (err) {
      toast.error(err.message);
      setErrors(err.details || {});
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    setBusy(true);
    try {
      const d = await api.del(`/services/${deleting.id}`);
      toast.ok(d.message);
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="page"><Loading rows={6} /></div>;

  return (
    <div className="page">
      <div className="row-between page-head">
        <div>
          <h1>บริการ (รายการบริการ)</h1>
          <div className="sub">จัดการประเภทบริการ ระยะเวลา และราคาของแต่ละบริการ</div>
        </div>
        {canEdit && (
          <div className="row gap-2">
            <button className="btn" onClick={() => setCatOpen(true)}>จัดการประเภท</button>
            <button className="btn primary" onClick={openCreate}>＋ เพิ่มบริการ</button>
          </div>
        )}
      </div>

      <div className="grid grid-4">
        <Stat label="บริการที่เปิดใช้งาน" value={stats.total} unit="รายการ" icon="✂" />
        <Stat label="ประเภทบริการ" value={stats.categories} unit="ประเภท" icon="🗂" />
        <Stat label="ราคาเฉลี่ย" value={baht(Math.round(stats.avgPrice))} icon="฿" />
        <Stat label="ระยะเวลาเฉลี่ย" value={Math.round(stats.avgDuration)} unit="นาที" icon="⏱" />
      </div>

      <div className="row-between wrap gap-2 mt-4" style={{ marginBottom: 14 }}>
        <div className="row gap-1 wrap">
          <button className={`btn sm ${categoryFilter === '' ? 'dark' : 'ghost'}`}
            onClick={() => setCategoryFilter('')}>ทั้งหมด</button>
          {categories.map((c) => (
            <button key={c.id} className={`btn sm ${categoryFilter === String(c.id) ? 'dark' : 'ghost'}`}
              onClick={() => setCategoryFilter(String(c.id))}>
              {ICONS[c.name] || '•'} {c.name}
            </button>
          ))}
        </div>
        <input className="input" style={{ maxWidth: 240, height: 32 }} placeholder="ค้นหาบริการ"
          value={search} onChange={(e) => setSearch(e.target.value)} />
      </div>

      {filtered.length === 0 ? (
        <Card><Empty icon="✂" title="ไม่พบบริการ" hint="ลองเปลี่ยนตัวกรอง หรือเพิ่มบริการใหม่" /></Card>
      ) : (
        <div className="grid grid-auto">
          {filtered.map((s) => (
            <div key={s.id} className="svc-card">
              <div className="svc-thumb">{ICONS[s.category_name] || '✂'}</div>
              <div className="body">
                <div className="row-between">
                  <div className="bold">{s.name}</div>
                  {!s.is_active && <span className="badge danger">ปิดใช้งาน</span>}
                </div>
                <div className="small muted">{s.description || s.category_name || 'บริการทั่วไป'}</div>
                <div className="row-between mt-2">
                  <div className="price">{baht(s.price)}</div>
                  <span className="badge">{s.duration_min} นาที</span>
                </div>
              </div>
              <div className="foot">
                <span>{s.category_name || 'ไม่ระบุประเภท'} · ใช้บริการแล้ว {s.booked_count} ครั้ง</span>
                {canEdit && (
                  <div className="row gap-1">
                    <button className="btn sm ghost" onClick={() => openEdit(s)}>แก้ไข</button>
                    {user.role === 'admin' && (
                      <button className="btn sm ghost" onClick={() => setDeleting(s)}>ลบ</button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* --------------------- ฟอร์มเพิ่ม/แก้ไขบริการ --------------------- */}
      <Modal
        open={!!editing}
        title={editing?.id ? `แก้ไขบริการ: ${editing.name}` : 'เพิ่มบริการใหม่'}
        onClose={() => setEditing(null)}
        footer={(
          <>
            <button className="btn" onClick={() => setEditing(null)}>ยกเลิก</button>
            <button className="btn primary" onClick={save} disabled={busy}>
              {busy && <span className="spinner" />}บันทึก
            </button>
          </>
        )}
      >
        <Field label="ชื่อบริการ" error={errors.name}>
          <input className="input" value={form.name}
            onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="เช่น ตัดผมชายทั่วไป" />
        </Field>

        <Field label="ประเภทบริการ" error={errors.category_id}>
          <select className="select" value={form.category_id}
            onChange={(e) => setForm((f) => ({ ...f, category_id: e.target.value }))}>
            <option value="">— ไม่ระบุ —</option>
            {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
        </Field>

        <div className="grid grid-2">
          <Field label="ระยะเวลา (นาที)" error={errors.duration_min}>
            <input className="input" type="number" min="1" max="600" value={form.duration_min}
              onChange={(e) => setForm((f) => ({ ...f, duration_min: e.target.value }))} />
          </Field>
          <Field label="ราคา (บาท)" error={errors.price}>
            <input className="input" type="number" min="0" step="10" value={form.price}
              onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))} />
          </Field>
        </div>

        <Field label="รายละเอียด">
          <textarea className="textarea" value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>

        <div className="row-between">
          <div>
            <div className="bold small">เปิดให้ลูกค้าเลือกบริการนี้</div>
            <div className="tiny muted">ปิดไว้ถ้ายังไม่พร้อมให้บริการ</div>
          </div>
          <Switch checked={form.is_active} onChange={(v) => setForm((f) => ({ ...f, is_active: v }))} />
        </div>
      </Modal>

      <CategoryModal open={catOpen} onClose={() => setCatOpen(false)} categories={categories} onChanged={load} />

      <ConfirmModal
        open={!!deleting}
        title="ยืนยันการลบบริการ"
        message={`ต้องการลบบริการ "${deleting?.name}" ใช่หรือไม่? หากบริการนี้เคยถูกใช้งานแล้ว ระบบจะปิดการใช้งานแทนการลบเพื่อรักษาประวัติคิว`}
        confirmText="ลบบริการ" danger busy={busy}
        onClose={() => setDeleting(null)} onConfirm={remove}
      />
    </div>
  );
}

/* ---------------------- จัดการประเภทบริการ ---------------------- */
function CategoryModal({ open, onClose, categories, onChanged }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  const add = async () => {
    if (!name.trim()) return;
    setBusy(true);
    try {
      await api.post('/services/categories', { name: name.trim() });
      setName('');
      toast.ok('เพิ่มประเภทบริการแล้ว');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c) => {
    try {
      await api.del(`/services/categories/${c.id}`);
      toast.ok('ลบประเภทบริการแล้ว');
      onChanged();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <Modal open={open} title="ประเภทบริการ" onClose={onClose}
      footer={<button className="btn dark" onClick={onClose}>ปิด</button>}>
      <div className="row gap-2" style={{ marginBottom: 16 }}>
        <input className="input" value={name} onChange={(e) => setName(e.target.value)}
          placeholder="ชื่อประเภทใหม่ เช่น ทำเล็บ"
          onKeyDown={(e) => e.key === 'Enter' && add()} />
        <button className="btn primary" onClick={add} disabled={busy || !name.trim()}>เพิ่ม</button>
      </div>

      {categories.map((c) => (
        <div key={c.id} className="row-between" style={{ padding: '9px 0', borderBottom: '1px solid var(--ink-100)' }}>
          <div>
            <div className="bold small">{ICONS[c.name] || '•'} {c.name}</div>
            <div className="tiny muted">{c.service_count} บริการ</div>
          </div>
          <button className="btn sm ghost" onClick={() => remove(c)}>ลบ</button>
        </div>
      ))}
    </Modal>
  );
}
