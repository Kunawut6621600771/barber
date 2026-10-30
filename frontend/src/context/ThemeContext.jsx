import { createContext, useContext, useEffect, useMemo, useState } from 'react';

const ThemeContext = createContext(null);
const KEY = 'tq_theme';

/** ธีมที่ควรใช้ตอนเปิดแอป: ที่ผู้ใช้เลือกไว้ ถ้าไม่เคยเลือกให้ตามเครื่อง */
function initialTheme() {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'light' || saved === 'dark') return saved;
  } catch { /* โหมดส่วนตัวอ่าน localStorage ไม่ได้ */ }
  return window.matchMedia?.('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
}

export function ThemeProvider({ children }) {
  const [theme, setTheme] = useState(initialTheme);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    try { localStorage.setItem(KEY, theme); } catch { /* ไม่เป็นไรถ้าบันทึกไม่ได้ */ }
  }, [theme]);

  // ผู้ใช้ยังไม่เคยเลือกเอง -> ตามการตั้งค่าของเครื่องเมื่อมันเปลี่ยน
  useEffect(() => {
    const mq = window.matchMedia?.('(prefers-color-scheme: dark)');
    if (!mq) return undefined;

    const onChange = (e) => {
      try { if (localStorage.getItem(KEY)) return; } catch { /* ignore */ }
      setTheme(e.matches ? 'dark' : 'light');
    };
    mq.addEventListener('change', onChange);
    return () => mq.removeEventListener('change', onChange);
  }, []);

  const value = useMemo(() => ({
    theme,
    isDark: theme === 'dark',
    setTheme,
    toggle: () => setTheme((t) => (t === 'dark' ? 'light' : 'dark')),
  }), [theme]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export const useTheme = () => useContext(ThemeContext) ?? { theme: 'light', isDark: false, toggle: () => {} };

/** ปุ่มสลับโหมดสว่าง/มืด */
export function ThemeToggle() {
  const { isDark, toggle } = useTheme();
  return (
    <button
      type="button"
      className="theme-toggle"
      onClick={toggle}
      title={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
      aria-label={isDark ? 'เปลี่ยนเป็นโหมดสว่าง' : 'เปลี่ยนเป็นโหมดมืด'}
    >
      {isDark ? '☀' : '🌙'}
    </button>
  );
}
