/** แผงซ้ายของหน้า Login / Register */
export default function AuthVisual() {
  return (
    <div className="auth-visual">
      <div>
        <div className="logo">EASY HAIR<br />STYLES</div>
        <div className="tag">ระบบเรียกคิวร้านตัดผม — จัดการคิวอย่างเป็นระบบ ลดเวลารอ ติดตามสถานะได้แบบเรียลไทม์</div>
      </div>

      <div className="points">
        <div className="point">
          <div className="n">1</div>
          <div>
            <div className="bold">รับบัตรคิวได้ทันที</div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>สแกน QR Code หน้าร้าน หรือกดรับคิวออนไลน์</div>
          </div>
        </div>
        <div className="point">
          <div className="n">2</div>
          <div>
            <div className="bold">รู้ว่าเหลืออีกกี่คิว</div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>ระบบแจ้งเตือนเมื่อใกล้ถึงคิวและเมื่อถึงคิวของคุณ</div>
          </div>
        </div>
        <div className="point">
          <div className="n">3</div>
          <div>
            <div className="bold">เลือกบริการและช่างได้</div>
            <div className="small" style={{ color: 'var(--ink-400)' }}>ตัดผม สระผม โกนหนวด ทำสีผม พร้อมราคาและเวลาที่ชัดเจน</div>
          </div>
        </div>
      </div>

      <div className="small" style={{ color: 'var(--ink-500)' }}>© {new Date().getFullYear()} Trim &amp; Co.</div>
    </div>
  );
}
