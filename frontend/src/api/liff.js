/**
 * LINE Front-end Framework (LIFF)
 * โหลด SDK จาก CDN ของ LINE เมื่อจำเป็นเท่านั้น (ไม่ต้อง npm install เพิ่ม)
 */
import { api } from './client.js';

const SDK_URL = 'https://static.line-scdn.net/liff/edge/2/sdk.js';

let configPromise = null;
let sdkPromise = null;
let initPromise = null;

/** { liff_id, liff_enabled, bot_enabled, add_friend_url } */
export function getLineConfig() {
  configPromise ??= api.get('/line/config').catch(() => ({ liff_enabled: false, bot_enabled: false }));
  return configPromise;
}

function loadSdk() {
  if (window.liff) return Promise.resolve(window.liff);
  sdkPromise ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = SDK_URL;
    s.async = true;
    s.onload = () => resolve(window.liff);
    s.onerror = () => { sdkPromise = null; reject(new Error('โหลด LINE SDK ไม่สำเร็จ')); };
    document.head.appendChild(s);
  });
  return sdkPromise;
}

/** init LIFF หนึ่งครั้งต่อการเปิดหน้า คืนค่า object liff */
export async function initLiff() {
  const cfg = await getLineConfig();
  if (!cfg.liff_id) throw new Error('ร้านยังไม่ได้ตั้งค่า LIFF');
  initPromise ??= loadSdk().then(async (liff) => {
    await liff.init({ liffId: cfg.liff_id });
    return liff;
  }).catch((err) => { initPromise = null; throw err; });
  return initPromise;
}

/** เปิดอยู่ในแอป LINE หรือไม่ (ดูจาก user agent ก่อน ไม่ต้องโหลด SDK) */
export const looksLikeLineApp = () => /\bLine\//i.test(navigator.userAgent);

/** ลิงก์เปิดหน้าในแอปผ่าน LINE */
export const liffUrl = (liffId, to = '/app/my-queue') =>
  `https://liff.line.me/${liffId}?to=${encodeURIComponent(to)}`;

/** รับเฉพาะ path ภายในแอป กัน open redirect */
export function safeTarget(to) {
  if (typeof to !== 'string') return null;
  return /^\/(app|track)(\/|$|\?)/.test(to) ? to : null;
}
