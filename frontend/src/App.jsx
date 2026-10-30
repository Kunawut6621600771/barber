import { BrowserRouter, Routes, Route, Navigate, useLocation } from 'react-router-dom';
import { AuthProvider, useAuth, isStaffRole } from './context/AuthContext.jsx';
import { ToastProvider } from './context/ToastContext.jsx';
import Layout from './components/Layout.jsx';

import Login from './pages/Login.jsx';
import Register from './pages/Register.jsx';
import ForgotPassword from './pages/ForgotPassword.jsx';
import ResetPassword from './pages/ResetPassword.jsx';
import Dashboard from './pages/Dashboard.jsx';
import QueueManage from './pages/QueueManage.jsx';
import Users from './pages/Users.jsx';
import Services from './pages/Services.jsx';
import Reports from './pages/Reports.jsx';
import MyQueue from './pages/MyQueue.jsx';
import TakeQueue from './pages/TakeQueue.jsx';
import Profile from './pages/Profile.jsx';
import Board from './pages/Board.jsx';
import TrackTicket from './pages/TrackTicket.jsx';
import Payments from './pages/Payments.jsx';
import Liff from './pages/Liff.jsx';
import Pos from './pages/Pos.jsx';
import Products from './pages/Products.jsx';
import Sales from './pages/Sales.jsx';
import Shifts from './pages/Shifts.jsx';
import Members from './pages/Members.jsx';
import SettingsPage from './pages/Settings.jsx';
import Book from './pages/Book.jsx';

function FullPageLoader() {
  return (
    <div style={{ display: 'grid', placeItems: 'center', minHeight: '100vh' }}>
      <div className="col gap-2 center">
        <span className="spinner" style={{ width: 26, height: 26 }} />
        <span className="small muted">กำลังโหลด...</span>
      </div>
    </div>
  );
}

/** ต้องเข้าสู่ระบบ (และมี role ที่อนุญาต) จึงเข้าถึงได้ */
function Protected({ roles, children }) {
  const { user, loading } = useAuth();
  const location = useLocation();

  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  if (roles && !roles.includes(user.role)) return <Navigate to="/app" replace />;
  return children;
}

/** /app -> หน้าแรกตามบทบาทของผู้ใช้ */
function HomeRedirect() {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (!user) return <Navigate to="/login" replace />;
  return <Navigate to={isStaffRole(user.role) ? '/app/dashboard' : '/app/my-queue'} replace />;
}

/** ถ้าเข้าสู่ระบบอยู่แล้ว ไม่ต้องเห็นหน้า login/register อีก */
function PublicOnly({ children }) {
  const { user, loading } = useAuth();
  if (loading) return <FullPageLoader />;
  if (user) return <Navigate to="/app" replace />;
  return children;
}

export default function App() {
  return (
    <BrowserRouter>
      <ToastProvider>
        <AuthProvider>
          <Routes>
            {/* ---------------------- สาธารณะ ---------------------- */}
            <Route path="/login" element={<PublicOnly><Login /></PublicOnly>} />
            <Route path="/register" element={<PublicOnly><Register /></PublicOnly>} />
            <Route path="/forgot-password" element={<PublicOnly><ForgotPassword /></PublicOnly>} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/board" element={<Board />} />
            <Route path="/track/:token" element={<TrackTicket />} />
            {/* จุดเข้าแอปจาก LINE (LIFF Endpoint URL) */}
            <Route path="/liff" element={<Liff />} />

            {/* ------------------ ต้องเข้าสู่ระบบ ------------------ */}
            <Route path="/app" element={<Protected><Layout /></Protected>}>
              <Route index element={<HomeRedirect />} />
              <Route path="dashboard" element={
                <Protected roles={['admin', 'staff', 'barber']}><Dashboard /></Protected>} />
              <Route path="queue" element={
                <Protected roles={['admin', 'staff', 'barber']}><QueueManage /></Protected>} />
              <Route path="users" element={
                <Protected roles={['admin', 'staff']}><Users /></Protected>} />
              <Route path="payments" element={
                <Protected roles={['admin', 'staff', 'barber']}><Payments /></Protected>} />
              <Route path="reports" element={
                <Protected roles={['admin', 'staff', 'barber']}><Reports /></Protected>} />
              <Route path="pos" element={
                <Protected roles={['admin', 'staff', 'barber']}><Pos /></Protected>} />
              <Route path="sales" element={
                <Protected roles={['admin', 'staff', 'barber']}><Sales /></Protected>} />
              <Route path="products" element={
                <Protected roles={['admin', 'staff', 'barber']}><Products /></Protected>} />
              <Route path="shifts" element={
                <Protected roles={['admin', 'staff', 'barber']}><Shifts /></Protected>} />
              <Route path="members" element={
                <Protected roles={['admin', 'staff', 'barber']}><Members /></Protected>} />
              <Route path="settings" element={
                <Protected roles={['admin', 'staff']}><SettingsPage /></Protected>} />
              <Route path="book" element={<Book />} />
              <Route path="services" element={<Services />} />
              <Route path="my-queue" element={<MyQueue />} />
              <Route path="take-queue" element={<TakeQueue />} />
              <Route path="profile" element={<Profile />} />
            </Route>

            {/* หน้ารับบัตรคิวจาก QR หน้าร้าน (ต้องล็อกอินก่อน) */}
            <Route path="/take-queue" element={<Navigate to="/app/take-queue" replace />} />

            <Route path="/" element={<Navigate to="/app" replace />} />
            <Route path="*" element={<Navigate to="/app" replace />} />
          </Routes>
        </AuthProvider>
      </ToastProvider>
    </BrowserRouter>
  );
}
