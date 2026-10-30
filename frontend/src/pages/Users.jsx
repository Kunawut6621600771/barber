import { useState, useEffect, useCallback } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth, ROLE_LABEL } from '../context/AuthContext.jsx';
import {
  Card, Stat, Avatar, Empty, Loading, Modal, ConfirmModal, Field,
  dateOf, dateTimeOf, StatusBadge,
} from '../components/ui.jsx';

const ROLE_TABS = [
  { key: '', label: 'ทั้งหมด' },
  { key: 'customer', label: 'ลูกค้า' },
  { key: 'barber', label: 'ช่างตัดผม' },
  { key: 'staff', label: 'พนักงาน' },
  { key: 'admin', label: 'ผู้ดูแลระบบ' },
];

const STATUS_BADGE = {
  active: { label: 'ใช้งาน', cls: 'ok' },
  inactive: { label: 'ปิดใช้งาน', cls: '' },
  suspended: { label: 'ระงับ', cls: 'danger' },
};

// บัญชีที่สมัครผ่าน LINE ได้อีเมลภายในระบบแบบนี้ ไม่มีประโยชน์ที่จะแสดง
const isLineEmail = (email) => /@line\.local$/i.test(email || '');

const emptyForm = {
  full_name: '', email: '', phone: '', role: 'customer', status: 'active',
  password: '', barber_code: '', nickname: '', specialty: '', note: '',
};

export default function Users() {
  const toast = useToast();
  const { user: me } = useAuth();
  const [params] = useSearchParams();

  const [rows, setRows] = useState([]);
  const [pagination, setPagination] = useState({ page: 1, pages: 1, total: 0 });
  const [loading, setLoading] = useState(true);
  const [role, setRole] = useState('');
  const [search, setSearch] = useState(params.get('q') || '');
  const [page, setPage] = useState(1);

  const [editing, setEditing] = useState(null);      // null = ปิด, {} = เพิ่มใหม่
  const [form, setForm] = useState(emptyForm);
  const [errors, setErrors] = useState({});
  const [busy, setBusy] = useState(false);
  const [deleting, setDeleting] = useState(null);
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const d = await api.get('/users', { role, search, page, limit: 12 });
      setRows(d.data);
      setPagination(d.pagination);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [role, search, page]);

  useEffect(() => {
    const t = setTimeout(load, search ? 320 : 0);   // debounce เฉพาะตอนพิมพ์ค้นหา
    return () => clearTimeout(t);
  }, [load, search]);

  const openCreate = () => { setForm(emptyForm); setErrors({}); setEditing({}); };
  const openEdit = (u) => {
    setForm({
      full_name: u.full_name, email: u.email, phone: u.phone || '',
      role: u.role, status: u.status, password: '',
      barber_code: u.barber_code || '', nickname: u.nickname || '',
      specialty: u.specialty || '', note: u.note || '',
    });
    setErrors({});
    setEditing(u);
  };

  const save = async () => {
    setBusy(true);
    setErrors({});
    try {
      const payload = { ...form };
      if (!payload.password) delete payload.password;
      if (payload.role !== 'barber') {
        delete payload.barber_code; delete payload.nickname; delete payload.specialty;
      }
      if (editing.id) {
        delete payload.password;
        delete payload.email;                        // ไม่อนุญาตให้แก้อีเมลจากหน้านี้
        await api.put(`/users/${editing.id}`, payload);
        toast.ok('บันทึกข้อมูลผู้ใช้เรียบร้อยแล้ว');
      } else {
        await api.post('/users', payload);
        toast.ok('เพิ่มผู้ใช้ใหม่เรียบร้อยแล้ว');
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
      await api.del(`/users/${deleting.id}`);
      toast.ok('ลบผู้ใช้เรียบร้อยแล้ว');
      setDeleting(null);
      load();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const openDetail = async (u) => {
    try {
      setDetail(await api.get(`/users/${u.id}`));
    } catch (err) { toast.error(err.message); }
  };

  return (
    <div className="page">
      <div className="row-between page-head">
        <div>
          <h1>การจัดการผู้ใช้งาน</h1>
          <div className="sub">จัดการข้อมูลลูกค้า พนักงาน และช่างตัดผม · ทั้งหมด {pagination.total} คน</div>
        </div>
        <button className="btn primary" onClick={openCreate}>＋ เพิ่มผู้ใช้</button>
      </div>

      <div className="grid grid-4">
        <Stat label="ผู้ใช้ทั้งหมด" value={pagination.total} unit="คน" icon="👥" />
        <Stat label="ลูกค้า" value={rows.filter((r) => r.role === 'customer').length} unit="คน (หน้านี้)" icon="🙋" />
        <Stat label="ช่างตัดผม" value={rows.filter((r) => r.role === 'barber').length} unit="คน (หน้านี้)" icon="✂" />
        <Stat label="พนักงาน/แอดมิน"
          value={rows.filter((r) => ['staff', 'admin'].includes(r.role)).length} unit="คน (หน้านี้)" icon="🛠" />
      </div>

      <Card className="mt-4" tight>
        <div className="row-between wrap gap-2" style={{ padding: '4px 4px 12px' }}>
          <div className="row gap-1 wrap">
            {ROLE_TABS.map((t) => (
              <button key={t.key} className={`btn sm ${role === t.key ? 'dark' : 'ghost'}`}
                onClick={() => { setRole(t.key); setPage(1); }}>{t.label}</button>
            ))}
          </div>
          <input className="input" style={{ maxWidth: 260, height: 32 }}
            placeholder="ค้นหาชื่อ ชื่อ LINE อีเมล หรือเบอร์โทร"
            value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }} />
        </div>

        {loading ? <Loading rows={6} /> : rows.length === 0 ? (
          <Empty icon="🔍" title="ไม่พบผู้ใช้งาน" hint="ลองเปลี่ยนคำค้นหาหรือตัวกรอง" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>ผู้ใช้งาน</th>
                  <th>เบอร์โทรศัพท์</th>
                  <th>ประเภท</th>
                  <th>สถานะ</th>
                  <th>เข้าใช้ล่าสุด</th>
                  <th className="right">มาใช้บริการ</th>
                  <th className="right">จัดการ</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => (
                  <tr key={u.id} onClick={() => openDetail(u)} style={{ cursor: 'pointer' }}>
                    <td>
                      <div className="row gap-2">
                        <Avatar name={u.full_name} src={u.line_picture_url || u.avatar_url} />
                        <div>
                          <div className="bold small">{u.full_name}</div>
                          {u.line_linked && (
                            <div className="tiny line-name">LINE: {u.line_display_name || 'เชื่อมแล้ว'}</div>
                          )}
                          {!isLineEmail(u.email) && <div className="tiny muted">{u.email}</div>}
                        </div>
                      </div>
                    </td>
                    <td className="small">{u.phone || <span className="muted">—</span>}</td>
                    <td>
                      <span className="badge">{ROLE_LABEL[u.role]}</span>
                      {u.barber_code && <div className="tiny muted mt-1">{u.barber_code}</div>}
                    </td>
                    <td>
                      <span className={`badge ${STATUS_BADGE[u.status].cls}`}>
                        <i className="dot-i" />{STATUS_BADGE[u.status].label}
                      </span>
                    </td>
                    <td className="small muted">{u.last_login_at ? dateTimeOf(u.last_login_at) : 'ยังไม่เคย'}</td>
                    <td className="right small">
                      <b>{u.total_visits}</b> ครั้ง
                      <div className="tiny muted">{u.last_visit_at ? dateOf(u.last_visit_at) : '—'}</div>
                    </td>
                    <td onClick={(e) => e.stopPropagation()}>
                      <div className="actions">
                        <button className="btn sm" onClick={() => openEdit(u)}>แก้ไข</button>
                        {me.role === 'admin' && u.id !== me.id && (
                          <button className="btn sm danger" onClick={() => setDeleting(u)}>ลบ</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {pagination.pages > 1 && (
          <div className="row-between" style={{ padding: '12px 4px 4px' }}>
            <span className="small muted">
              หน้า {pagination.page} จาก {pagination.pages} · ทั้งหมด {pagination.total} รายการ
            </span>
            <div className="row gap-1">
              <button className="btn sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>ก่อนหน้า</button>
              <button className="btn sm" disabled={page >= pagination.pages} onClick={() => setPage((p) => p + 1)}>ถัดไป</button>
            </div>
          </div>
        )}
      </Card>

      {/* --------------------------- ฟอร์ม --------------------------- */}
      <Modal
        open={!!editing}
        title={editing?.id ? `แก้ไขข้อมูล: ${editing.full_name}` : 'เพิ่มผู้ใช้ใหม่'}
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
        <Field label="ชื่อ-นามสกุล" error={errors.full_name}>
          <input className="input" value={form.full_name}
            onChange={(e) => setForm((f) => ({ ...f, full_name: e.target.value }))} />
        </Field>

        <Field label="อีเมล" error={errors.email}
          hint={editing?.id ? 'ไม่สามารถแก้ไขอีเมลของผู้ใช้ที่มีอยู่แล้วได้' : undefined}>
          <input className="input" type="email" value={form.email} disabled={!!editing?.id}
            onChange={(e) => setForm((f) => ({ ...f, email: e.target.value }))} />
        </Field>

        <Field label="เบอร์โทรศัพท์" error={errors.phone}>
          <input className="input" value={form.phone}
            onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))} placeholder="08x-xxx-xxxx" />
        </Field>

        <div className="grid grid-2">
          <Field label="ประเภทผู้ใช้">
            <select className="select" value={form.role}
              onChange={(e) => setForm((f) => ({ ...f, role: e.target.value }))}>
              {Object.entries(ROLE_LABEL)
                .filter(([k]) => me?.role === 'admin' || k !== 'admin' || form.role === 'admin')
                .map(([k, v]) => <option key={k} value={k} disabled={k === 'admin' && me?.role !== 'admin'}>{v}</option>)}
            </select>
          </Field>
          <Field label="สถานะ">
            <select className="select" value={form.status}
              onChange={(e) => setForm((f) => ({ ...f, status: e.target.value }))}>
              <option value="active">ใช้งาน</option>
              <option value="inactive">ปิดใช้งาน</option>
              <option value="suspended">ระงับ</option>
            </select>
          </Field>
        </div>

        {form.role === 'barber' && (
          <div className="grid grid-2">
            <Field label="รหัสช่าง" hint="เว้นว่างให้ระบบสร้างให้">
              <input className="input" value={form.barber_code}
                onChange={(e) => setForm((f) => ({ ...f, barber_code: e.target.value }))} placeholder="BB-04" />
            </Field>
            <Field label="ชื่อเล่น">
              <input className="input" value={form.nickname}
                onChange={(e) => setForm((f) => ({ ...f, nickname: e.target.value }))} />
            </Field>
            <div style={{ gridColumn: '1 / -1' }}>
              <Field label="ความถนัด">
                <input className="input" value={form.specialty}
                  onChange={(e) => setForm((f) => ({ ...f, specialty: e.target.value }))}
                  placeholder="เช่น Skin Fade, ทำสีผม" />
              </Field>
            </div>
          </div>
        )}

        {!editing?.id && (
          <Field label="รหัสผ่านเริ่มต้น" error={errors.password}
            hint="เว้นว่างไว้ได้ ผู้ใช้จะตั้งรหัสผ่านเองผ่านลิงก์ “ลืมรหัสผ่าน”">
            <input className="input" type="text" value={form.password}
              onChange={(e) => setForm((f) => ({ ...f, password: e.target.value }))} placeholder="อย่างน้อย 6 ตัวอักษร" />
          </Field>
        )}

        <Field label="หมายเหตุ">
          <textarea className="textarea" value={form.note}
            onChange={(e) => setForm((f) => ({ ...f, note: e.target.value }))} />
        </Field>
      </Modal>

      {/* ------------------------ รายละเอียด ------------------------ */}
      <Modal open={!!detail} title="ประวัติการใช้บริการ" onClose={() => setDetail(null)} wide
        footer={<button className="btn dark" onClick={() => setDetail(null)}>ปิด</button>}>
        {detail && (
          <>
            <div className="row gap-3" style={{ marginBottom: 18 }}>
              <Avatar name={detail.user.full_name} size="lg"
                src={detail.user.line_picture_url || detail.user.avatar_url} />
              <div>
                <h2>{detail.user.full_name}</h2>
                {detail.user.line_linked && (
                  <div className="small line-name">LINE: {detail.user.line_display_name || 'เชื่อมแล้ว'}</div>
                )}
                <div className="small muted">
                  {isLineEmail(detail.user.email) ? 'สมัครผ่าน LINE' : detail.user.email} · {detail.user.phone || 'ไม่มีเบอร์โทร'}
                </div>
                <div className="row gap-2 mt-1">
                  <span className="badge">{ROLE_LABEL[detail.user.role]}</span>
                  <span className={`badge ${STATUS_BADGE[detail.user.status].cls}`}>
                    {STATUS_BADGE[detail.user.status].label}
                  </span>
                  {detail.user.barber_code && <span className="badge dark">{detail.user.barber_code}</span>}
                </div>
              </div>
            </div>

            {detail.history.length === 0 ? (
              <Empty icon="🗒" title="ยังไม่มีประวัติการใช้บริการ" />
            ) : (
              <div className="table-wrap">
                <table className="data">
                  <thead>
                    <tr><th>วันที่</th><th>คิว</th><th>บริการ</th><th>ช่าง</th><th>สถานะ</th></tr>
                  </thead>
                  <tbody>
                    {detail.history.map((h) => (
                      <tr key={h.id}>
                        <td className="small">{dateOf(h.queue_date)}</td>
                        <td className="bold mono small">{h.ticket_no}</td>
                        <td className="small">{h.service_name}</td>
                        <td className="small">{h.barber_name || '—'}</td>
                        <td><StatusBadge status={h.status} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>

      <ConfirmModal
        open={!!deleting}
        title="ยืนยันการลบผู้ใช้"
        message={`ต้องการลบ "${deleting?.full_name}" ออกจากระบบใช่หรือไม่? การกระทำนี้ย้อนกลับไม่ได้`}
        confirmText="ลบผู้ใช้" danger busy={busy}
        onClose={() => setDeleting(null)} onConfirm={remove}
      />
    </div>
  );
}
