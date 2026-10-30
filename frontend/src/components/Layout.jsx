import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth, ROLE_LABEL, isStaffRole } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRealtime } from '../api/realtime.js';
import { api } from '../api/client.js';
import { Avatar, Modal, dateTimeOf } from './ui.jsx';
import { ThemeToggle } from '../context/ThemeContext.jsx';

const STAFF_NAV = [
  { to: '/app/dashboard', th: 'ภาพรวม', icon: '▦' },
  { to: '/app/queue', th: 'คิว', icon: '≡', key: 'waiting' },
  { to: '/app/transfers', th: 'ประวัติการโอน', icon: '🧾', group: 'ขาย', roles: ['admin', 'staff'] },
  { to: '/app/book', th: 'จองล่วงหน้า', icon: '📅', group: 'ลูกค้า' },
  { to: '/app/members', th: 'สมาชิก / แต้ม', icon: '⭐', group: 'ลูกค้า' },
  { to: '/app/users', th: 'ผู้ใช้งาน', icon: '👥', group: 'ลูกค้า', roles: ['admin', 'staff'] },
  { to: '/app/services', th: 'บริการ', icon: '✂', group: 'จัดการ' },
  { to: '/app/reports', th: 'รายงาน', icon: '▤', group: 'จัดการ' },
  { to: '/app/settings', th: 'ตั้งค่าร้าน', icon: '⚙', group: 'จัดการ', roles: ['admin', 'staff'] },
];

const CUSTOMER_NAV = [
  { to: '/app/my-queue', th: 'คิวของฉัน', icon: '🎫' },
  { to: '/app/take-queue', th: 'รับบัตรคิว', icon: '＋' },
  { to: '/app/book', th: 'จองล่วงหน้า', icon: '📅' },
  { to: '/app/services', th: 'บริการและราคา', icon: '✂' },
  { to: '/app/profile', th: 'ข้อมูลส่วนตัว', icon: '👤' },
];

export default function Layout() {
  const { user, logout } = useAuth();
  const toast = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [open, setOpen] = useState(false);
  const [notifications, setNotifications] = useState([]);
  const [unread, setUnread] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [waitingCount, setWaitingCount] = useState(0);
  const [shopName, setShopName] = useState('Trim & Co.');

  const staff = isStaffRole(user?.role);
  const nav = (staff ? STAFF_NAV : CUSTOMER_NAV).filter((i) => !i.roles || i.roles.includes(user.role));

  const loadNotifications = useCallback(async () => {
    try {
      const d = await api.get('/notifications', { limit: 20 });
      setNotifications(d.data);
      setUnread(d.unread);
    } catch { /* ไม่รบกวนผู้ใช้ถ้าโหลดแจ้งเตือนไม่สำเร็จ */ }
  }, []);

  const loadWaiting = useCallback(async () => {
    try {
      const d = await api.get('/queue/current');
      setWaitingCount(d.waiting_count);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { loadNotifications(); }, [loadNotifications]);
  useEffect(() => {
    api.get('/settings/public')
      .then((d) => d.shop_name && setShopName(d.shop_name))
      .catch(() => { /* ใช้ชื่อเริ่มต้นไปก่อน */ });
  }, []);
  useEffect(() => { if (staff) loadWaiting(); }, [staff, loadWaiting, location.pathname]);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // แจ้งเตือนแบบ real-time
  useRealtime({
    notification: (n) => {
      setNotifications((prev) => [n, ...prev].slice(0, 20));
      setUnread((u) => u + 1);
      toast.info(`${n.title} — ${n.message}`);
    },
    'queue:update': (d) => {
      if (!staff) return;
      if (Array.isArray(d?.tickets)) setWaitingCount(d.tickets.filter((t) => t.status === 'waiting').length);
      else loadWaiting();
    },
  });

  const markAllRead = async () => {
    await api.patch('/notifications/read-all');
    setNotifications((n) => n.map((x) => ({ ...x, is_read: true })));
    setUnread(0);
  };

  const onLogout = async () => {
    await logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="sidebar-brand logo-brand">
          <img src="/logo.png" alt={shopName} className="brand-logo" />
          <div className="sub">{staff ? 'Management Console' : 'ระบบเรียกคิว'}</div>
        </div>

        <nav className="col gap-1">
          {nav.map((item, i) => (
            <div key={item.to}>
              {item.group && item.group !== nav[i - 1]?.group && (
                <div className="nav-group-label">{item.group}</div>
              )}
              <NavLink to={item.to}
                className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
                <span aria-hidden>{item.icon}</span>
                <span>{item.th}</span>
                {item.key === 'waiting' && waitingCount > 0 && (
                  <span className="badge-count">{waitingCount}</span>
                )}
              </NavLink>
            </div>
          ))}
        </nav>

        {staff && (
          <>
            <div className="nav-group-label">อื่น ๆ</div>
            <NavLink to="/board" target="_blank" className="nav-item">
              <span aria-hidden>🖵</span><span>จอแสดงคิวหน้าร้าน</span>
            </NavLink>
            <NavLink to="/app/profile" className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span aria-hidden>⚙</span><span>ตั้งค่าบัญชี</span>
            </NavLink>
          </>
        )}

        <div className="sidebar-footer">
          <div className="row" style={{ padding: '6px 8px' }}>
            <Avatar name={user.full_name} />
            <div className="grow" style={{ minWidth: 0 }}>
              <div className="small bold" style={{ color: '#fff', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {user.full_name}
              </div>
              <div className="tiny" style={{ color: '#94a3b8' }}>{ROLE_LABEL[user.role]}</div>
            </div>
          </div>
          <button className="nav-item" onClick={onLogout}>
            <span aria-hidden>⏻</span><span>ออกจากระบบ</span>
          </button>
        </div>
      </aside>

      <div className="main">
        <header className="topbar">
          <button className="icon-btn menu-toggle" onClick={() => setOpen((o) => !o)} aria-label="เมนู">☰</button>

          <div className="search">
            <span className="icon" aria-hidden>⌕</span>
            <input
              placeholder={staff ? 'ค้นหาคิว ลูกค้า หรือบริการ...' : 'ค้นหาบริการ...'}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && e.currentTarget.value.trim()) {
                  navigate(`/app/${staff ? 'queue' : 'services'}?q=${encodeURIComponent(e.currentTarget.value.trim())}`);
                }
              }}
            />
          </div>

          <div className="grow" />

          <ThemeToggle />
          <button className="icon-btn" onClick={() => { setPanelOpen(true); loadNotifications(); }} aria-label="การแจ้งเตือน">
            🔔{unread > 0 && <span className="dot">{unread > 9 ? '9+' : unread}</span>}
          </button>
          <NavLink to="/app/profile" className="row gap-2" style={{ textDecoration: 'none' }}>
            <Avatar name={user.full_name} />
          </NavLink>
        </header>

        <Outlet context={{ reloadNotifications: loadNotifications }} />
      </div>

      <Modal
        open={panelOpen}
        title="การแจ้งเตือน"
        onClose={() => setPanelOpen(false)}
        footer={(
          <>
            <button className="btn" onClick={markAllRead} disabled={!unread}>ทำเครื่องหมายอ่านทั้งหมด</button>
            <button className="btn dark" onClick={() => setPanelOpen(false)}>ปิด</button>
          </>
        )}
      >
        {notifications.length === 0 ? (
          <p className="muted center">ยังไม่มีการแจ้งเตือน</p>
        ) : (
          <div className="col">
            {notifications.map((n) => (
              <div key={n.id} className="row gap-3" style={{
                padding: '11px 0', borderBottom: '1px solid var(--ink-100)',
                opacity: n.is_read ? 0.6 : 1,
              }}>
                <div style={{
                  width: 8, height: 8, borderRadius: '50%', flex: '0 0 8px',
                  background: n.is_read ? 'var(--ink-300)' : 'var(--brand)',
                }} />
                <div className="grow">
                  <div className="bold small">{n.title}</div>
                  <div className="small muted">{n.message}</div>
                  <div className="tiny muted mt-1">{dateTimeOf(n.created_at)}</div>
                </div>
              </div>
            ))}
          </div>
        )}
      </Modal>
    </div>
  );
}
