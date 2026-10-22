import { useState, useEffect, useCallback } from 'react';
import { NavLink, useNavigate, useLocation, Outlet } from 'react-router-dom';
import { useAuth, ROLE_LABEL, isStaffRole } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRealtime } from '../api/realtime.js';
import { api } from '../api/client.js';
import { Avatar, Modal, dateTimeOf } from './ui.jsx';

const STAFF_NAV = [
  { to: '/app/dashboard', label: 'Dashboard', th: 'ภาพรวม', icon: '▦' },
  { to: '/app/queue', label: 'Queue', th: 'คิว', icon: '≡', key: 'waiting' },
  { to: '/app/payments', label: 'Payments', th: 'การชำระเงิน', icon: '฿' },
  { to: '/app/users', label: 'Users', th: 'ผู้ใช้งาน', icon: '👥', roles: ['admin', 'staff'] },
  { to: '/app/services', label: 'Services', th: 'บริการ', icon: '✂' },
  { to: '/app/reports', label: 'Reports', th: 'รายงาน', icon: '▤' },
];

const CUSTOMER_NAV = [
  { to: '/app/my-queue', label: 'คิวของฉัน', icon: '🎫' },
  { to: '/app/take-queue', label: 'รับบัตรคิว', icon: '＋' },
  { to: '/app/services', label: 'บริการ', icon: '✂' },
  { to: '/app/profile', label: 'ข้อมูลส่วนตัว', icon: '👤' },
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
  useEffect(() => { if (staff) loadWaiting(); }, [staff, loadWaiting, location.pathname]);
  useEffect(() => { setOpen(false); }, [location.pathname]);

  // แจ้งเตือนแบบ real-time
  useRealtime({
    notification: (n) => {
      setNotifications((prev) => [n, ...prev].slice(0, 20));
      setUnread((u) => u + 1);
      toast.info(`${n.title} — ${n.message}`);
    },
    'queue:update': (d) => setWaitingCount(d.tickets.filter((t) => t.status === 'waiting').length),
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
        <div className="sidebar-brand">
          <div className="mark">T</div>
          <div>
            <div className="name">Trim &amp; Co.</div>
            <div className="sub">{staff ? 'Management Console' : 'ระบบเรียกคิว'}</div>
          </div>
        </div>

        <nav className="col gap-1">
          {nav.map((item) => (
            <NavLink key={item.to} to={item.to}
              className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <span aria-hidden>{item.icon}</span>
              <span>{item.th || item.label}</span>
              {item.key === 'waiting' && waitingCount > 0 && (
                <span className="badge-count">{waitingCount}</span>
              )}
            </NavLink>
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
