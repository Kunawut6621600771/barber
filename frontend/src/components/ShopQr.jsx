import { useState, useEffect } from 'react';
import { api } from '../api/client.js';

/** QR หน้าร้าน (สแกนด้วย LINE -> รับบัตรคิว) ใช้บนหน้า Login และจอแสดงคิว */
export default function ShopQr({ size = 160, title = 'สแกนรับบัตรคิวผ่าน LINE', hint }) {
  const [qr, setQr] = useState(null);

  useEffect(() => {
    api.get('/queue/shop-qr').then(setQr).catch(() => {});
  }, []);

  if (!qr?.qr_code) return null;

  return (
    <div className="shop-qr">
      <img src={qr.qr_code} alt="QR หน้าร้าน" width={size} height={size} />
      <div className="shop-qr-text">
        <div className="shop-qr-title">{title}</div>
        <div className="shop-qr-hint">{hint ?? 'เปิดกล้องหรือแอป LINE แล้วสแกน เพื่อรับบัตรคิวและติดตามสถานะบนมือถือ'}</div>
      </div>
    </div>
  );
}
