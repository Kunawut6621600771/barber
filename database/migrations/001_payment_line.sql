-- =====================================================================
--  Migration 001 : ชำระเงินด้วย QR PromptPay + LINE Bot / LIFF
--  รันซ้ำได้ (idempotent) — ไม่ลบข้อมูลเดิม
--    npm run db:migrate
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 1. ผูกบัญชีผู้ใช้กับ LINE
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_user_id      VARCHAR(64);
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_display_name VARCHAR(150);
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_picture_url  TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS line_linked_at    TIMESTAMPTZ;
CREATE UNIQUE INDEX IF NOT EXISTS uniq_users_line_user_id
    ON users(line_user_id) WHERE line_user_id IS NOT NULL;

-- ---------------------------------------------------------------------
-- 2. การชำระเงิน (จ่ายก่อน -> ได้บัตรคิว)
-- ---------------------------------------------------------------------
DO $$ BEGIN
    CREATE TYPE payment_status AS ENUM ('pending', 'paid', 'expired', 'cancelled', 'failed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS payments (
    id             BIGSERIAL PRIMARY KEY,
    ref_code       VARCHAR(20)   NOT NULL UNIQUE,            -- เลขอ้างอิงที่ลูกค้าเห็น เช่น PAY-8F3K2Q
    customer_id    BIGINT        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    service_id     BIGINT        NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    barber_id      BIGINT        REFERENCES barbers(id) ON DELETE SET NULL,
    source         queue_source  NOT NULL DEFAULT 'online',
    amount         NUMERIC(10,2) NOT NULL CHECK (amount >= 0),
    promptpay_id   VARCHAR(20)   NOT NULL,
    status         payment_status NOT NULL DEFAULT 'pending',
    method         VARCHAR(20)   NOT NULL DEFAULT 'promptpay'
                   CHECK (method IN ('promptpay', 'cash', 'manual')),

    -- ผลการตรวจสลิป
    slip_provider  VARCHAR(20),
    slip_trans_ref VARCHAR(80),                               -- เลขอ้างอิงธุรกรรมจากธนาคาร กันใช้สลิปซ้ำ
    slip_amount    NUMERIC(10,2),
    slip_paid_at   TIMESTAMPTZ,
    slip_data      JSONB,
    fail_reason    TEXT,
    verify_attempts INT NOT NULL DEFAULT 0,

    ticket_id      BIGINT REFERENCES queue_tickets(id) ON DELETE SET NULL,
    approved_by    BIGINT REFERENCES users(id) ON DELETE SET NULL,  -- กรณีพนักงานยืนยันเอง
    expires_at     TIMESTAMPTZ   NOT NULL,
    paid_at        TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payments_trans_ref
    ON payments(slip_trans_ref) WHERE slip_trans_ref IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_payments_customer ON payments(customer_id, status);
CREATE INDEX IF NOT EXISTS idx_payments_created  ON payments(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_payments_ticket   ON payments(ticket_id);

DROP TRIGGER IF EXISTS trg_payments_updated ON payments;
CREATE TRIGGER trg_payments_updated BEFORE UPDATE ON payments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMIT;
