import ShopQr from './ShopQr.jsx';

/** แผงซ้ายของหน้า Login / Register — โลโก้กลางจอ พร้อมแสงวิ้ง */
const SPARKS = [
  { top: '4%',  left: '10%', size: 22, delay: '0s' },
  { top: '-6%', left: '62%', size: 16, delay: '.9s' },
  { top: '18%', left: '94%', size: 26, delay: '1.6s' },
  { top: '78%', left: '4%',  size: 14, delay: '2.3s' },
  { top: '92%', left: '48%', size: 20, delay: '.4s' },
  { top: '70%', left: '88%', size: 15, delay: '1.2s' },
];

export default function AuthVisual({ showQr = false }) {
  return (
    <div className="auth-visual">
      <div className="auth-logo">
        <div className="auth-logo-glow" />
        <img src="/logo.png" alt="ร้านตัดผมโครตซิ่ง" />
        <div className="auth-logo-shine" />
        {SPARKS.map((s, i) => (
          <svg key={i} className="spark" viewBox="0 0 24 24" aria-hidden="true"
               style={{ top: s.top, left: s.left, width: s.size, height: s.size, animationDelay: s.delay }}>
            <path d="M12 0c.6 6.4 5.6 11.4 12 12-6.4.6-11.4 5.6-12 12-.6-6.4-5.6-11.4-12-12C6.4 11.4 11.4 6.4 12 0z" />
          </svg>
        ))}
      </div>

      {showQr && <div className="auth-qr"><ShopQr size={132} /></div>}

      <div className="auth-copy">© {new Date().getFullYear()} ร้านตัดผมโครตซิ่ง</div>
    </div>
  );
}
