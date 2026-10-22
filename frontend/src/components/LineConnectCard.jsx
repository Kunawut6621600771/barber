import { useEffect, useState } from 'react';
import { api } from '../api/client.js';
import { getLineConfig, liffUrl } from '../api/liff.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card } from './ui.jsx';

/**
 * การ์ด "รับแจ้งเตือนคิวผ่าน LINE"
 *  - ยังไม่เชื่อม: ปุ่มเชื่อมบัญชี (เปิดผ่าน LIFF) + ปุ่มเพิ่มเพื่อน OA
 *  - เชื่อมแล้ว : แสดงชื่อ LINE + ปุ่มยกเลิก (เฉพาะแบบเต็ม)
 */
export default function LineConnectCard({ compact = false, className = '' }) {
  const { user, refreshUser } = useAuth();
  const toast = useToast();
  const [cfg, setCfg] = useState(null);
  const [me, setMe] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    getLineConfig().then(setCfg);
    api.get('/line/me').then(setMe).catch(() => setMe({ linked: false }));
  }, []);

  if (!cfg || !me) return null;
  if (!cfg.liff_enabled && !cfg.bot_enabled) return null;
  if (compact && me.linked) return null;

  const unlink = async () => {
    setBusy(true);
    try {
      const d = await api.del('/line/link');
      toast.ok(d.message);
      setMe({ linked: false });
      refreshUser().catch(() => {});
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  const connectHref = cfg.liff_id ? liffUrl(cfg.liff_id, compact ? '/app/my-queue' : '/app/profile') : null;

  return (
    <Card className={`line-card ${className}`} title={compact ? null : 'แจ้งเตือนผ่าน LINE'}
      subtitle={compact ? null : 'รับแจ้งเตือนเมื่อใกล้ถึงคิว ถึงคิว และสถานะการชำระเงินในแชท LINE'}>
      {me.linked ? (
        <div className="row gap-2" style={{ alignItems: 'center' }}>
          {me.picture_url ? <img src={me.picture_url} alt="" className="line-pic" /> : <span className="line-dot">L</span>}
          <div className="grow">
            <div className="bold">เชื่อมต่อแล้ว{me.display_name ? ` · ${me.display_name}` : ''}</div>
            <div className="tiny muted">ระบบจะส่งแจ้งเตือนคิวไปที่ LINE ของคุณ</div>
          </div>
          {!compact && <button className="btn sm ghost" onClick={unlink} disabled={busy}>ยกเลิกการเชื่อมต่อ</button>}
        </div>
      ) : (
        <>
          <div className="row gap-2" style={{ alignItems: 'center' }}>
            <span className="line-dot">L</span>
            <div className="grow">
              <div className="bold">{compact ? 'รับแจ้งเตือนคิวทาง LINE' : 'ยังไม่ได้เชื่อมต่อ LINE'}</div>
              <div className="tiny muted">
                {cfg.add_friend_url ? 'เพิ่มเพื่อน LINE ของร้าน แล้วกดเชื่อมบัญชี' : 'กดเชื่อมบัญชีเพื่อรับแจ้งเตือน'}
                {user?.role !== 'customer' ? ' (พนักงานใช้ทดสอบได้)' : ''}
              </div>
            </div>
          </div>
          <div className="row gap-2 mt-2 wrap">
            {connectHref && <a className="btn line sm" href={connectHref}>เชื่อมบัญชี LINE</a>}
            {cfg.add_friend_url && (
              <a className="btn sm" href={cfg.add_friend_url} target="_blank" rel="noreferrer">เพิ่มเพื่อน LINE ร้าน</a>
            )}
          </div>
        </>
      )}
    </Card>
  );
}
