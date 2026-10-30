import { createContext, useContext, useState, useCallback, useMemo } from 'react';

const ToastContext = createContext(null);

export function ToastProvider({ children }) {
  const [toasts, setToasts] = useState([]);

  const remove = useCallback((id) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  const push = useCallback((message, kind = 'ok', ms = 3800) => {
    const id = Math.random().toString(36).slice(2);
    setToasts((t) => [...t, { id, message, kind }]);
    setTimeout(() => remove(id), ms);
  }, [remove]);

  // memo ไว้ ไม่งั้นทุกครั้งที่มี toast ใหม่ ผู้ใช้ context ทั้งแอปจะ re-render ตาม
  const toast = useMemo(() => ({
    ok: (m) => push(m, 'ok'),
    success: (m) => push(m, 'ok'),        // ชื่อพ้องให้เรียกได้ทั้งสองแบบ
    error: (m) => push(m, 'error'),
    warn: (m) => push(m, 'info'),
    info: (m) => push(m, 'info'),
  }), [push]);

  return (
    <ToastContext.Provider value={toast}>
      {children}
      <div className="toast-stack">
        {toasts.map((t) => (
          <div key={t.id} className={`toast ${t.kind}`}>
            <span>{t.kind === 'ok' ? '✓' : t.kind === 'error' ? '!' : 'i'}</span>
            <span className="grow">{t.message}</span>
            <button className="close" onClick={() => remove(t.id)} aria-label="ปิด">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}

export const useToast = () => {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used inside <ToastProvider>');
  return ctx;
};
