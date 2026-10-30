-- =====================================================================
--  Migration 004 : ผูกบัญชี LINE ด้วยการสแกน QR
--
--  ลูกค้าสแกน QR บนหน้าจอ -> LINE เปิดห้องแชทร้านพร้อมข้อความที่มีรหัส
--  -> กดส่ง -> webhook จับรหัสแล้วผูก line_user_id เข้ากับบัญชีให้อัตโนมัติ
--  (ใช้ได้แม้ลูกค้าเปิดเว็บบนคอมพิวเตอร์หรือเครื่องของร้าน)
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS line_link_tokens (
    code       VARCHAR(16) PRIMARY KEY,
    user_id    BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    ticket_id  BIGINT REFERENCES queue_tickets(id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    used_at    TIMESTAMPTZ,
    used_by    VARCHAR(64),                      -- line_user_id ที่ใช้รหัสนี้
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_link_token_user ON line_link_tokens(user_id, used_at);

COMMIT;
