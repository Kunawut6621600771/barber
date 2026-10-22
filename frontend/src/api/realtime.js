import { useEffect, useRef } from 'react';
import { api } from './client.js';

/**
 * รับ event แบบ real-time ผ่าน SSE
 *
 *   useRealtime({ 'queue:update': (d) => setQueue(d.tickets) })
 *
 * handlers ถูกเก็บไว้ใน ref จึงไม่ต้องใส่ใน dependency (ไม่ต้อง useCallback ทุกตัว)
 */
export function useRealtime(handlers, enabled = true) {
  const ref = useRef(handlers);
  ref.current = handlers;

  useEffect(() => {
    if (!enabled) return undefined;

    const token = api.tokens.token;
    const url = `/api/notifications/stream${token ? `?token=${encodeURIComponent(token)}` : ''}`;
    const es = new EventSource(url);

    const names = Object.keys(ref.current);
    const listeners = names.map((name) => {
      const fn = (e) => {
        let data = null;
        try { data = JSON.parse(e.data); } catch { data = e.data; }
        ref.current[name]?.(data);
      };
      es.addEventListener(name, fn);
      return [name, fn];
    });

    return () => {
      listeners.forEach(([name, fn]) => es.removeEventListener(name, fn));
      es.close();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);
}
