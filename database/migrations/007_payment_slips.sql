-- =====================================================================
--  Migration 007 : เก็บรูปสลิปที่ลูกค้าอัปโหลด (รันซ้ำได้ ไม่ลบข้อมูล)
--   เก็บทุกครั้งที่ส่งสลิป ทั้งที่ตรวจผ่านและไม่ผ่าน ให้พนักงานเปิดดูย้อนหลังได้
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS payment_slips (
    id          BIGSERIAL PRIMARY KEY,
    payment_id  BIGINT       NOT NULL REFERENCES payments(id) ON DELETE CASCADE,
    mime        VARCHAR(30)  NOT NULL,
    image       BYTEA        NOT NULL,
    ok          BOOLEAN      NOT NULL,                        -- ตรวจสลิปผ่านหรือไม่
    reason      TEXT,                                          -- เหตุผลที่ไม่ผ่าน
    uploaded_by BIGINT       REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_payment_slips_payment ON payment_slips(payment_id, id DESC);

COMMIT;
