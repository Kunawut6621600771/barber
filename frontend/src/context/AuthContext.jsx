import { createContext, useContext, useState, useEffect, useCallback } from 'react';
import { api } from '../api/client.js';

const AuthContext = createContext(null);

export const ROLE_LABEL = {
  admin: 'ผู้ดูแลระบบ',
  staff: 'พนักงานหน้าร้าน',
  barber: 'ช่างตัดผม',
  customer: 'ลูกค้า',
};

export const isStaffRole = (role) => ['admin', 'staff', 'barber'].includes(role);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  // โหลดข้อมูลผู้ใช้จาก token ที่เก็บไว้ตอนเปิดแอป
  useEffect(() => {
    if (!api.tokens.token) { setLoading(false); return; }
    api.get('/auth/me')
      .then((d) => setUser(d.user))
      .catch(() => { api.tokens.token = null; api.tokens.refresh = null; })
      .finally(() => setLoading(false));
  }, []);

  const login = useCallback(async (email, password) => {
    const d = await api.post('/auth/login', { email, password });
    api.tokens.token = d.token;
    api.tokens.refresh = d.refresh_token;
    setUser(d.user);
    return d.user;
  }, []);

  /** ใช้ token ที่ได้จาก API อื่น (เช่น เข้าสู่ระบบด้วย LINE) */
  const loginWithSession = useCallback((d) => {
    api.tokens.token = d.token;
    if (d.refresh_token) api.tokens.refresh = d.refresh_token;
    setUser(d.user);
    return d.user;
  }, []);

  const register = useCallback(async (payload) => {
    const d = await api.post('/auth/register', payload);
    api.tokens.token = d.token;
    setUser(d.user);
    return d.user;
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout', { refresh_token: api.tokens.refresh });
    } catch { /* ออกจากระบบฝั่ง client ต่อไปแม้ API ล้มเหลว */ }
    api.tokens.token = null;
    api.tokens.refresh = null;
    setUser(null);
  }, []);

  const refreshUser = useCallback(async () => {
    const d = await api.get('/auth/me');
    setUser(d.user);
    return d.user;
  }, []);

  return (
    <AuthContext.Provider value={{ user, setUser, loading, login, loginWithSession, register, logout, refreshUser }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
};
