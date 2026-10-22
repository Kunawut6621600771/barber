import { useEffect, useState } from 'react';

/* ------------------------------ helpers ----------------------------- */

export const initials = (name = '') =>
  name.trim().split(/\s+/).slice(0, 2).map((w) => w[0]).join('').toUpperCase() || '?';

export const baht = (n) =>
  '฿' + Number(n || 0).toLocaleString('th-TH', { minimumFractionDigits: 0, maximumFractionDigits: 2 });

export const minutes = (n) => (n === null || n === undefined ? '—' : `${Number(n).toFixed(0)} นาที`);

export const timeOf = (iso) =>
  iso ? new Date(iso).toLocaleTimeString('th-TH', { hour: '2-digit', minute: '2-digit' }) : '—';

export const dateOf = (v) =>
  v ? new Date(v).toLocaleDateString('th-TH', { day: 'numeric', month: 'short', year: '2-digit' }) : '—';

export const dateTimeOf = (iso) => (iso ? `${dateOf(iso)} ${timeOf(iso)}` : '—');

/** เวลาผ่านไปแล้วกี่นาที (เช่น "รอมา 12 นาที") */
export function sinceMinutes(iso) {
  if (!iso) return null;
  return Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
}

/* ------------------------------- badges ----------------------------- */

export const QUEUE_STATUS = {
  waiting:   { label: 'รอคิว',          cls: '' },
  called:    { label: 'เรียกแล้ว',      cls: 'info' },
  serving:   { label: 'กำลังให้บริการ', cls: 'warn' },
  done:      { label: 'เสร็จสิ้น',      cls: 'ok' },
  cancelled: { label: 'ยกเลิก',         cls: 'danger' },
  skipped:   { label: 'ข้ามคิว',        cls: 'warn' },
  no_show:   { label: 'ไม่มาตามคิว',    cls: 'danger' },
};

export const BARBER_STATUS = {
  available: { label: 'ว่าง',            cls: 'ok' },
  serving:   { label: 'กำลังให้บริการ',  cls: 'warn' },
  break:     { label: 'พัก',             cls: '' },
  off:       { label: 'ไม่อยู่',          cls: 'danger' },
};

export const SOURCE_LABEL = { walk_in: 'หน้าร้าน', qr_code: 'QR Code', online: 'ออนไลน์' };

export function StatusBadge({ status }) {
  const s = QUEUE_STATUS[status] || { label: status, cls: '' };
  return <span className={`badge ${s.cls}`}><i className="dot-i" />{s.label}</span>;
}

export function BarberBadge({ status }) {
  const s = BARBER_STATUS[status] || { label: status, cls: '' };
  return <span className={`badge ${s.cls}`}><i className="dot-i" />{s.label}</span>;
}

export function Avatar({ name, size = '' }) {
  return <div className={`avatar ${size}`}>{initials(name)}</div>;
}

/* -------------------------------- stat ------------------------------ */

export function Stat({ label, value, unit, delta, icon, tone }) {
  return (
    <div className="stat">
      <div className="label">{icon && <span>{icon}</span>}{label}</div>
      <div className="value" style={tone ? { color: tone } : undefined}>
        {value}{unit && <small>{unit}</small>}
      </div>
      {delta && <div className={`delta ${delta.startsWith('-') ? 'down' : 'up'}`}>{delta}</div>}
    </div>
  );
}

/* -------------------------------- card ------------------------------ */

export function Card({ title, subtitle, action, children, tight, className = '' }) {
  return (
    <div className={`card ${className}`}>
      {(title || action) && (
        <div className="card-head">
          <div>
            {title && <h3>{title}</h3>}
            {subtitle && <div className="small muted">{subtitle}</div>}
          </div>
          {action}
        </div>
      )}
      <div className={`card-body ${tight ? 'tight' : ''}`}>{children}</div>
    </div>
  );
}

/* ------------------------------- modal ------------------------------ */

export function Modal({ open, title, onClose, children, footer, wide }) {
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e) => e.key === 'Escape' && onClose?.();
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [open, onClose]);

  if (!open) return null;
  return (
    <div className="modal-backdrop" onMouseDown={(e) => e.target === e.currentTarget && onClose?.()}>
      <div className={`modal ${wide ? 'wide' : ''}`} role="dialog" aria-modal="true">
        <div className="modal-head">
          <h2>{title}</h2>
          <button className="btn ghost sm" onClick={onClose} aria-label="ปิด">✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-foot">{footer}</div>}
      </div>
    </div>
  );
}

/** กล่องยืนยันก่อนทำรายการที่ย้อนกลับไม่ได้ */
export function ConfirmModal({ open, title, message, confirmText = 'ยืนยัน', danger, onConfirm, onClose, busy }) {
  return (
    <Modal
      open={open}
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className={`btn ${danger ? 'primary' : 'dark'}`} onClick={onConfirm} disabled={busy}>
            {busy && <span className="spinner" />}{confirmText}
          </button>
        </>
      )}
    >
      <p>{message}</p>
    </Modal>
  );
}

/* ------------------------------- fields ----------------------------- */

export function Field({ label, error, hint, children }) {
  return (
    <div className="field">
      {label && <label>{label}</label>}
      {children}
      {error && <span className="err">{error}</span>}
      {!error && hint && <span className="hint">{hint}</span>}
    </div>
  );
}

export function PasswordInput({ value, onChange, placeholder, autoComplete, error }) {
  const [show, setShow] = useState(false);
  return (
    <div className="input-group">
      <input
        className={`input ${error ? 'error' : ''}`}
        type={show ? 'text' : 'password'}
        value={value}
        onChange={onChange}
        placeholder={placeholder}
        autoComplete={autoComplete}
      />
      <button type="button" className="suffix" onClick={() => setShow((s) => !s)}
        aria-label={show ? 'ซ่อนรหัสผ่าน' : 'แสดงรหัสผ่าน'}>
        {show ? '🙈' : '👁'}
      </button>
    </div>
  );
}

export function Switch({ checked, onChange }) {
  return (
    <label className="switch">
      <input type="checkbox" checked={!!checked} onChange={(e) => onChange(e.target.checked)} />
      <span className="slider" />
    </label>
  );
}

/* ------------------------------- misc ------------------------------- */

export function Empty({ icon = '📭', title, hint }) {
  return (
    <div className="empty">
      <div className="icon">{icon}</div>
      <div className="bold">{title}</div>
      {hint && <div className="small muted mt-1">{hint}</div>}
    </div>
  );
}

export function Loading({ rows = 3 }) {
  return (
    <div className="col gap-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skel" style={{ height: 44 }} />
      ))}
    </div>
  );
}

export function Alert({ kind = 'info', children }) {
  const icon = { error: '⚠', ok: '✓', info: 'ℹ' }[kind];
  return <div className={`alert ${kind}`}><span>{icon}</span><span>{children}</span></div>;
}
