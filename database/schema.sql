-- =====================================================================
--  ระบบเรียกคิวร้านตัดผม (Barbershop Queue Management System)
--  Database : PostgreSQL 14+
--  File     : schema.sql  -- โครงสร้างฐานข้อมูล
-- =====================================================================
--  วิธีใช้:
--    createdb -U postgres barbershop
--    psql -U postgres -d barbershop -f database/schema.sql
--    psql -U postgres -d barbershop -f database/seed.sql
-- =====================================================================

BEGIN;

-- ---------------------------------------------------------------------
-- 0. Extensions & helper
-- ---------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS pgcrypto;   -- gen_random_uuid(), digest()

DROP TABLE IF EXISTS payments            CASCADE;   -- จาก migrations/001
DROP TABLE IF EXISTS queue_events        CASCADE;
DROP TABLE IF EXISTS notifications       CASCADE;
DROP TABLE IF EXISTS queue_tickets       CASCADE;
DROP TABLE IF EXISTS barber_services     CASCADE;
DROP TABLE IF EXISTS services            CASCADE;
DROP TABLE IF EXISTS service_categories  CASCADE;
DROP TABLE IF EXISTS barbers             CASCADE;
DROP TABLE IF EXISTS password_resets     CASCADE;
DROP TABLE IF EXISTS refresh_tokens      CASCADE;
DROP TABLE IF EXISTS users               CASCADE;
DROP TABLE IF EXISTS shop_settings       CASCADE;

DROP TYPE IF EXISTS user_role     CASCADE;
DROP TYPE IF EXISTS user_status   CASCADE;
DROP TYPE IF EXISTS barber_status CASCADE;
DROP TYPE IF EXISTS queue_status  CASCADE;
DROP TYPE IF EXISTS queue_source  CASCADE;
DROP TYPE IF EXISTS notify_type   CASCADE;
DROP TYPE IF EXISTS payment_status CASCADE;

-- ---------------------------------------------------------------------
-- 1. ENUM types
-- ---------------------------------------------------------------------
CREATE TYPE user_role     AS ENUM ('admin', 'staff', 'barber', 'customer');
CREATE TYPE user_status   AS ENUM ('active', 'inactive', 'suspended');
CREATE TYPE barber_status AS ENUM ('available', 'serving', 'break', 'off');
-- waiting  = รอ | called = เรียกแล้ว | serving = กำลังให้บริการ
-- done     = เสร็จสิ้น | cancelled = ยกเลิก | skipped = ข้ามคิว | no_show = ไม่มาตามคิว
CREATE TYPE queue_status  AS ENUM ('waiting', 'called', 'serving', 'done', 'cancelled', 'skipped', 'no_show');
CREATE TYPE queue_source  AS ENUM ('walk_in', 'qr_code', 'online');
CREATE TYPE notify_type   AS ENUM ('near_turn', 'your_turn', 'cancelled', 'skipped', 'called_again', 'done');

-- ---------------------------------------------------------------------
-- 2. trigger function : updated_at
-- ---------------------------------------------------------------------
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 3. USER MANAGEMENT
-- =====================================================================

-- ตารางผู้ใช้งาน : ลูกค้า / พนักงาน / ช่างตัดผม / ผู้ดูแลระบบ
CREATE TABLE users (
    id             BIGSERIAL PRIMARY KEY,
    full_name      VARCHAR(150)  NOT NULL,
    email          VARCHAR(180)  NOT NULL UNIQUE,
    phone          VARCHAR(20),
    password_hash  VARCHAR(255),                       -- NULL = ยังไม่ได้ตั้งรหัสผ่าน (Create Password)
    role           user_role     NOT NULL DEFAULT 'customer',
    status         user_status   NOT NULL DEFAULT 'active',
    avatar_url     TEXT,
    birth_date     DATE,
    note           TEXT,
    -- ตั้งค่าการแจ้งเตือนรายบุคคล
    notify_near_turn BOOLEAN NOT NULL DEFAULT TRUE,
    notify_my_turn   BOOLEAN NOT NULL DEFAULT TRUE,
    notify_cancel    BOOLEAN NOT NULL DEFAULT TRUE,
    last_login_at  TIMESTAMPTZ,
    created_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    CONSTRAINT users_email_lower CHECK (email = LOWER(email)),
    CONSTRAINT users_phone_format CHECK (phone IS NULL OR phone ~ '^[0-9+\-() ]{6,20}$')
);
CREATE INDEX idx_users_role   ON users(role);
CREATE INDEX idx_users_status ON users(status);
CREATE INDEX idx_users_phone  ON users(phone);
CREATE TRIGGER trg_users_updated BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- Refresh token / session (Logout = เพิกถอน token)
CREATE TABLE refresh_tokens (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    user_agent  TEXT,
    ip_address  VARCHAR(60),
    expires_at  TIMESTAMPTZ NOT NULL,
    revoked_at  TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_refresh_user ON refresh_tokens(user_id);

-- Forgot Password / Create Password (ใช้ token เดียวกัน คนละ purpose)
CREATE TABLE password_resets (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  VARCHAR(255) NOT NULL UNIQUE,
    purpose     VARCHAR(20)  NOT NULL DEFAULT 'reset'
                CHECK (purpose IN ('reset', 'create')),
    expires_at  TIMESTAMPTZ NOT NULL,
    used_at     TIMESTAMPTZ,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_reset_user ON password_resets(user_id);

-- ข้อมูลช่างตัดผม (ขยายจาก users ที่ role = 'barber')
CREATE TABLE barbers (
    id          BIGSERIAL PRIMARY KEY,
    user_id     BIGINT NOT NULL UNIQUE REFERENCES users(id) ON DELETE CASCADE,
    code        VARCHAR(20)  NOT NULL UNIQUE,          -- รหัสช่าง เช่น BB-01
    nickname    VARCHAR(80),
    specialty   VARCHAR(150),                          -- ความถนัด เช่น Fade, Classic
    bio         TEXT,
    status      barber_status NOT NULL DEFAULT 'off',
    rating      NUMERIC(3,2)  NOT NULL DEFAULT 5.00 CHECK (rating BETWEEN 0 AND 5),
    hired_at    DATE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_barbers_status ON barbers(status);
CREATE TRIGGER trg_barbers_updated BEFORE UPDATE ON barbers
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 4. SERVICE MANAGEMENT
-- =====================================================================

-- ประเภทบริการ เช่น ตัดผม / สระผม / โกนหนวด / ทำสีผม
CREATE TABLE service_categories (
    id          BIGSERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL UNIQUE,
    description TEXT,
    sort_order  INT NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT TRUE,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_cat_updated BEFORE UPDATE ON service_categories
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- รายการบริการ + ระยะเวลา + ราคา
CREATE TABLE services (
    id            BIGSERIAL PRIMARY KEY,
    category_id   BIGINT REFERENCES service_categories(id) ON DELETE SET NULL,
    name          VARCHAR(120)  NOT NULL,
    description   TEXT,
    duration_min  INT           NOT NULL CHECK (duration_min > 0 AND duration_min <= 600),
    price         NUMERIC(10,2) NOT NULL CHECK (price >= 0),
    image_url     TEXT,
    is_active     BOOLEAN NOT NULL DEFAULT TRUE,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (category_id, name)
);
CREATE INDEX idx_services_active ON services(is_active);
CREATE TRIGGER trg_services_updated BEFORE UPDATE ON services
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ช่างคนไหนทำบริการอะไรได้ (many-to-many)
CREATE TABLE barber_services (
    barber_id  BIGINT NOT NULL REFERENCES barbers(id)  ON DELETE CASCADE,
    service_id BIGINT NOT NULL REFERENCES services(id) ON DELETE CASCADE,
    PRIMARY KEY (barber_id, service_id)
);

-- =====================================================================
-- 5. QUEUE MANAGEMENT
-- =====================================================================

-- บัตรคิว
CREATE TABLE queue_tickets (
    id                 BIGSERIAL PRIMARY KEY,
    ticket_no          VARCHAR(20)  NOT NULL,              -- เช่น B-042
    queue_date         DATE         NOT NULL DEFAULT CURRENT_DATE,
    seq                INT          NOT NULL,              -- ลำดับที่ออกบัตรของวันนั้น
    position           INT,                                -- ลำดับในคิวรอปัจจุบัน (คำนวณใหม่ได้)
    priority           INT          NOT NULL DEFAULT 0,    -- ยิ่งมาก ยิ่งได้คิวก่อน (จองล่วงหน้า/VIP)

    customer_id        BIGINT REFERENCES users(id)    ON DELETE SET NULL,
    guest_name         VARCHAR(150),                       -- กรณีลูกค้า walk-in ไม่มีบัญชี
    guest_phone        VARCHAR(20),
    service_id         BIGINT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    barber_id          BIGINT REFERENCES barbers(id)  ON DELETE SET NULL,

    status             queue_status NOT NULL DEFAULT 'waiting',
    source             queue_source NOT NULL DEFAULT 'walk_in',
    qr_token           UUID         NOT NULL DEFAULT gen_random_uuid(),  -- ใช้ติดตามคิวผ่าน QR

    recall_count       INT NOT NULL DEFAULT 0,             -- จำนวนครั้งที่เรียกคิวซ้ำ
    skip_count         INT NOT NULL DEFAULT 0,             -- จำนวนครั้งที่ถูกข้ามคิว
    estimated_wait_min INT,                                -- เวลารอโดยประมาณตอนออกบัตร
    cancel_reason      TEXT,

    issued_at          TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    called_at          TIMESTAMPTZ,
    started_at         TIMESTAMPTZ,
    finished_at        TIMESTAMPTZ,
    cancelled_at       TIMESTAMPTZ,
    created_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at         TIMESTAMPTZ NOT NULL DEFAULT NOW(),

    CONSTRAINT queue_ticket_unique_per_day UNIQUE (queue_date, ticket_no),
    CONSTRAINT queue_seq_unique_per_day    UNIQUE (queue_date, seq),
    CONSTRAINT queue_has_customer CHECK (customer_id IS NOT NULL OR guest_name IS NOT NULL)
);
CREATE INDEX idx_queue_date_status ON queue_tickets(queue_date, status);
CREATE INDEX idx_queue_customer    ON queue_tickets(customer_id);
CREATE INDEX idx_queue_barber      ON queue_tickets(barber_id);
CREATE INDEX idx_queue_qr          ON queue_tickets(qr_token);
CREATE TRIGGER trg_queue_updated BEFORE UPDATE ON queue_tickets
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ลูกค้า 1 คน มีคิวที่ยัง active ได้แค่ 1 ใบต่อวัน
CREATE UNIQUE INDEX uniq_active_ticket_per_customer
    ON queue_tickets(queue_date, customer_id)
    WHERE customer_id IS NOT NULL
      AND status IN ('waiting', 'called', 'serving');

-- ประวัติการเปลี่ยนสถานะคิว (audit trail) -> ใช้ทำรายงาน
CREATE TABLE queue_events (
    id          BIGSERIAL PRIMARY KEY,
    ticket_id   BIGINT NOT NULL REFERENCES queue_tickets(id) ON DELETE CASCADE,
    event_type  VARCHAR(30) NOT NULL,     -- issue, call, recall, skip, start, done, cancel
    from_status queue_status,
    to_status   queue_status,
    actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    note        TEXT,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_events_ticket ON queue_events(ticket_id);
CREATE INDEX idx_events_time   ON queue_events(created_at);

-- =====================================================================
-- 6. NOTIFICATION
-- =====================================================================
CREATE TABLE notifications (
    id         BIGSERIAL PRIMARY KEY,
    user_id    BIGINT REFERENCES users(id) ON DELETE CASCADE,
    ticket_id  BIGINT REFERENCES queue_tickets(id) ON DELETE CASCADE,
    type       notify_type NOT NULL,
    title      VARCHAR(160) NOT NULL,
    message    TEXT NOT NULL,
    channel    VARCHAR(20) NOT NULL DEFAULT 'in_app'
               CHECK (channel IN ('in_app', 'sms', 'email', 'line')),
    is_read    BOOLEAN NOT NULL DEFAULT FALSE,
    read_at    TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_notify_user_unread ON notifications(user_id, is_read);
CREATE INDEX idx_notify_created     ON notifications(created_at DESC);

-- กันการยิงแจ้งเตือนชนิดเดิมซ้ำสำหรับคิวเดียวกัน
CREATE UNIQUE INDEX uniq_notify_ticket_type
    ON notifications(ticket_id, type)
    WHERE ticket_id IS NOT NULL AND type IN ('near_turn', 'your_turn', 'cancelled');

-- =====================================================================
-- 7. SHOP SETTINGS (ค่าคอนฟิกร้าน)
-- =====================================================================
CREATE TABLE shop_settings (
    key         VARCHAR(60) PRIMARY KEY,
    value       TEXT NOT NULL,
    description TEXT,
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_settings_updated BEFORE UPDATE ON shop_settings
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- =====================================================================
-- 8. FUNCTIONS : ออกเลขคิวอัตโนมัติ + จัดลำดับคิวอัตโนมัติ
-- =====================================================================

-- ออกหมายเลขคิวอัตโนมัติ : รีเซ็ตทุกวัน  B-001, B-002, ...
CREATE OR REPLACE FUNCTION next_ticket_no(p_date DATE DEFAULT CURRENT_DATE)
RETURNS TABLE (out_seq INT, out_ticket_no VARCHAR) AS $$
DECLARE
    v_seq INT;
    v_prefix TEXT;
BEGIN
    SELECT COALESCE(value, 'B') INTO v_prefix FROM shop_settings WHERE key = 'ticket_prefix';
    IF v_prefix IS NULL THEN v_prefix := 'B'; END IF;

    -- ล็อกทั้งวันเพื่อกันเลขคิวชนกันเวลารับบัตรพร้อมกัน
    PERFORM pg_advisory_xact_lock(hashtext('queue_seq_' || p_date::TEXT));

    SELECT COALESCE(MAX(seq), 0) + 1 INTO v_seq
      FROM queue_tickets WHERE queue_date = p_date;

    RETURN QUERY SELECT v_seq, (v_prefix || '-' || LPAD(v_seq::TEXT, 3, '0'))::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- จัดลำดับคิวอัตโนมัติ : เรียงตาม priority DESC แล้วตามเวลาออกบัตร
CREATE OR REPLACE FUNCTION reorder_queue(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY priority DESC, skip_count ASC, issued_at ASC) AS rn
          FROM queue_tickets
         WHERE queue_date = p_date AND status = 'waiting'
    )
    UPDATE queue_tickets q
       SET position = r.rn
      FROM ranked r
     WHERE q.id = r.id AND q.position IS DISTINCT FROM r.rn;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    -- คิวที่ไม่ได้อยู่ในสถานะรอ ไม่ต้องมี position
    UPDATE queue_tickets
       SET position = NULL
     WHERE queue_date = p_date AND status <> 'waiting' AND position IS NOT NULL;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- คำนวณเวลารอโดยประมาณ (นาที) ของคิวที่ยังรออยู่ก่อนหน้า
CREATE OR REPLACE FUNCTION estimate_wait_minutes(p_date DATE, p_position INT)
RETURNS INT AS $$
DECLARE
    v_total INT;
    v_barbers INT;
BEGIN
    SELECT COALESCE(SUM(s.duration_min), 0) INTO v_total
      FROM queue_tickets q
      JOIN services s ON s.id = q.service_id
     WHERE q.queue_date = p_date
       AND q.status IN ('waiting', 'called', 'serving')
       AND (q.position IS NULL OR q.position < p_position);

    SELECT GREATEST(COUNT(*), 1) INTO v_barbers
      FROM barbers WHERE status IN ('available', 'serving');

    RETURN CEIL(v_total::NUMERIC / v_barbers)::INT;
END;
$$ LANGUAGE plpgsql;

-- =====================================================================
-- 9. VIEWS สำหรับ Dashboard / Report
-- =====================================================================

-- คิวปัจจุบัน + คิวที่รอ พร้อมข้อมูลที่ใช้แสดงผล
CREATE OR REPLACE VIEW v_queue_board AS
SELECT q.id,
       q.ticket_no,
       q.queue_date,
       q.seq,
       q.position,
       q.status,
       q.source,
       q.priority,
       q.recall_count,
       q.skip_count,
       q.issued_at,
       q.called_at,
       q.started_at,
       q.finished_at,
       q.estimated_wait_min,
       COALESCE(u.full_name, q.guest_name)   AS customer_name,
       COALESCE(u.phone,     q.guest_phone)  AS customer_phone,
       q.customer_id,
       s.id      AS service_id,
       s.name    AS service_name,
       s.duration_min,
       s.price,
       b.id      AS barber_id,
       bu.full_name AS barber_name,
       b.code    AS barber_code
  FROM queue_tickets q
  JOIN services s      ON s.id  = q.service_id
  LEFT JOIN users u    ON u.id  = q.customer_id
  LEFT JOIN barbers b  ON b.id  = q.barber_id
  LEFT JOIN users bu   ON bu.id = b.user_id;

-- สถิติประจำวัน (รายงานจำนวนลูกค้า + เวลารอเฉลี่ย)
CREATE OR REPLACE VIEW v_daily_stats AS
SELECT queue_date,
       COUNT(*)                                                   AS total_tickets,
       COUNT(*) FILTER (WHERE status = 'done')                    AS done_count,
       COUNT(*) FILTER (WHERE status = 'cancelled')               AS cancelled_count,
       COUNT(*) FILTER (WHERE status = 'no_show')                 AS no_show_count,
       COUNT(*) FILTER (WHERE status = 'waiting')                 AS waiting_count,
       COUNT(*) FILTER (WHERE status IN ('called','serving'))     AS active_count,
       COUNT(DISTINCT customer_id)                                AS unique_customers,
       ROUND(AVG(EXTRACT(EPOCH FROM (called_at - issued_at)) / 60.0)
             FILTER (WHERE called_at IS NOT NULL), 1)             AS avg_wait_min,
       ROUND(AVG(EXTRACT(EPOCH FROM (finished_at - started_at)) / 60.0)
             FILTER (WHERE finished_at IS NOT NULL AND started_at IS NOT NULL), 1) AS avg_service_min,
       COALESCE(SUM(s.price) FILTER (WHERE q.status = 'done'), 0) AS revenue
  FROM queue_tickets q
  JOIN services s ON s.id = q.service_id
 GROUP BY queue_date;

-- รายงานการให้บริการของช่าง
CREATE OR REPLACE VIEW v_barber_performance AS
SELECT b.id            AS barber_id,
       b.code,
       u.full_name     AS barber_name,
       b.status,
       b.rating,
       q.queue_date,
       COUNT(q.id) FILTER (WHERE q.status = 'done')  AS served_count,
       COALESCE(SUM(s.price) FILTER (WHERE q.status = 'done'), 0) AS revenue,
       ROUND(AVG(EXTRACT(EPOCH FROM (q.finished_at - q.started_at)) / 60.0)
             FILTER (WHERE q.finished_at IS NOT NULL), 1) AS avg_service_min
  FROM barbers b
  JOIN users u        ON u.id = b.user_id
  LEFT JOIN queue_tickets q ON q.barber_id = b.id
  LEFT JOIN services s      ON s.id = q.service_id
 GROUP BY b.id, b.code, u.full_name, b.status, b.rating, q.queue_date;

COMMIT;
