-- =====================================================================
--  Migration 002 : ระบบ POS (ขายหน้าร้าน) + สต็อกสินค้า + กะเงินสด
--                  + สมาชิกสะสมแต้ม + โค้ดส่วนลด + การจองล่วงหน้า
--  รันซ้ำได้ (idempotent) — ไม่ลบข้อมูลเดิม
--    npm run db:migrate
-- =====================================================================
BEGIN;

-- ---------------------------------------------------------------------
-- 0. ENUM ที่ต้องใช้
-- ---------------------------------------------------------------------
DO $$ BEGIN CREATE TYPE sale_status        AS ENUM ('open','paid','void','refunded','partial_refund');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE shift_status       AS ENUM ('open','closed');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE appointment_status AS ENUM ('pending','confirmed','cancelled','done','no_show');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ---------------------------------------------------------------------
-- 1. สินค้า (ขายหน้าร้าน: แว็กซ์ แชมพู ใบมีด ฯลฯ)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
    id              BIGSERIAL PRIMARY KEY,
    sku             VARCHAR(40)   UNIQUE,
    name            VARCHAR(150)  NOT NULL,
    category        VARCHAR(60)   NOT NULL DEFAULT 'ทั่วไป',
    description     TEXT,
    cost_price      NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (cost_price  >= 0),
    price           NUMERIC(10,2) NOT NULL           CHECK (price       >= 0),
    stock_qty       INT           NOT NULL DEFAULT 0,
    low_stock_level INT           NOT NULL DEFAULT 5 CHECK (low_stock_level >= 0),
    track_stock     BOOLEAN       NOT NULL DEFAULT TRUE,
    image_url       TEXT,
    is_active       BOOLEAN       NOT NULL DEFAULT TRUE,
    created_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at      TIMESTAMPTZ   NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_products_active   ON products(is_active);
CREATE INDEX IF NOT EXISTS idx_products_category ON products(category);
DROP TRIGGER IF EXISTS trg_products_updated ON products;
CREATE TRIGGER trg_products_updated BEFORE UPDATE ON products
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ประวัติการเคลื่อนไหวสต็อก (ตัดสต็อกตอนขาย / รับเข้า / ปรับยอด / คืนของ)
CREATE TABLE IF NOT EXISTS stock_movements (
    id            BIGSERIAL PRIMARY KEY,
    product_id    BIGINT  NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    change_qty    INT     NOT NULL,                       -- + รับเข้า / - ตัดออก
    balance_after INT     NOT NULL,
    reason        VARCHAR(20) NOT NULL
                  CHECK (reason IN ('sale','restock','adjust','refund','void','damage')),
    sale_id       BIGINT,
    note          TEXT,
    actor_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_stock_product ON stock_movements(product_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 2. กะเงินสด (เปิด/ปิดลิ้นชัก)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_shifts (
    id              BIGSERIAL PRIMARY KEY,
    opened_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    closed_by       BIGINT REFERENCES users(id) ON DELETE SET NULL,
    opening_float   NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (opening_float >= 0),
    counted_cash    NUMERIC(12,2),                       -- เงินสดที่นับได้ตอนปิดกะ
    expected_cash   NUMERIC(12,2),                       -- ที่ระบบคำนวณว่าควรมี
    difference      NUMERIC(12,2),                       -- นับได้ - ควรมี (ขาด/เกิน)
    cash_in         NUMERIC(12,2) NOT NULL DEFAULT 0,    -- นำเงินเข้าลิ้นชักระหว่างกะ
    cash_out        NUMERIC(12,2) NOT NULL DEFAULT 0,    -- เบิกเงินออก
    note            TEXT,
    status          shift_status NOT NULL DEFAULT 'open',
    opened_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    closed_at       TIMESTAMPTZ
);
-- เปิดกะค้างไว้ได้ครั้งละ 1 กะเท่านั้น
CREATE UNIQUE INDEX IF NOT EXISTS uniq_single_open_shift
    ON cash_shifts ((status = 'open'::shift_status)) WHERE status = 'open';
CREATE INDEX IF NOT EXISTS idx_shifts_opened ON cash_shifts(opened_at DESC);

-- เงินเข้า/ออกลิ้นชักระหว่างกะ (ไม่ใช่การขาย)
CREATE TABLE IF NOT EXISTS cash_movements (
    id         BIGSERIAL PRIMARY KEY,
    shift_id   BIGINT NOT NULL REFERENCES cash_shifts(id) ON DELETE CASCADE,
    direction  VARCHAR(4) NOT NULL CHECK (direction IN ('in','out')),
    amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    reason     TEXT NOT NULL,
    actor_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_cash_mov_shift ON cash_movements(shift_id);

-- ---------------------------------------------------------------------
-- 3. บิลขาย (POS)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
    id               BIGSERIAL PRIMARY KEY,
    bill_no          VARCHAR(24)  NOT NULL UNIQUE,        -- INV-20261022-0007
    sale_date        DATE         NOT NULL DEFAULT CURRENT_DATE,
    shift_id         BIGINT REFERENCES cash_shifts(id)   ON DELETE SET NULL,
    customer_id      BIGINT REFERENCES users(id)         ON DELETE SET NULL,
    guest_name       VARCHAR(150),
    guest_phone      VARCHAR(20),
    ticket_id        BIGINT REFERENCES queue_tickets(id) ON DELETE SET NULL,
    barber_id        BIGINT REFERENCES barbers(id)       ON DELETE SET NULL,
    cashier_id       BIGINT REFERENCES users(id)         ON DELETE SET NULL,

    subtotal         NUMERIC(12,2) NOT NULL DEFAULT 0,
    discount_type    VARCHAR(10) CHECK (discount_type IN ('amount','percent')),
    discount_value   NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_value >= 0),
    discount_amount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    promo_code       VARCHAR(30),
    points_used      INT           NOT NULL DEFAULT 0 CHECK (points_used >= 0),
    points_discount  NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (points_discount >= 0),
    tax_rate         NUMERIC(5,2)  NOT NULL DEFAULT 0 CHECK (tax_rate >= 0),
    tax_amount       NUMERIC(12,2) NOT NULL DEFAULT 0,
    total            NUMERIC(12,2) NOT NULL DEFAULT 0 CHECK (total >= 0),
    paid_total       NUMERIC(12,2) NOT NULL DEFAULT 0,
    change_amount    NUMERIC(12,2) NOT NULL DEFAULT 0,
    refunded_amount  NUMERIC(12,2) NOT NULL DEFAULT 0,
    points_earned    INT           NOT NULL DEFAULT 0,

    status           sale_status NOT NULL DEFAULT 'open',
    note             TEXT,
    void_reason      TEXT,
    paid_at          TIMESTAMPTZ,
    created_at       TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at       TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sales_date     ON sales(sale_date DESC);
CREATE INDEX IF NOT EXISTS idx_sales_status   ON sales(status);
CREATE INDEX IF NOT EXISTS idx_sales_customer ON sales(customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_shift    ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_ticket   ON sales(ticket_id);
DROP TRIGGER IF EXISTS trg_sales_updated ON sales;
CREATE TRIGGER trg_sales_updated BEFORE UPDATE ON sales
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- คิว 1 ใบ เปิดบิลที่ยังไม่ยกเลิกได้ใบเดียว
CREATE UNIQUE INDEX IF NOT EXISTS uniq_sale_per_ticket
    ON sales(ticket_id) WHERE ticket_id IS NOT NULL AND status <> 'void';

CREATE TABLE IF NOT EXISTS sale_items (
    id              BIGSERIAL PRIMARY KEY,
    sale_id         BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    kind            VARCHAR(10) NOT NULL CHECK (kind IN ('service','product')),
    service_id      BIGINT REFERENCES services(id) ON DELETE SET NULL,
    product_id      BIGINT REFERENCES products(id) ON DELETE SET NULL,
    name            VARCHAR(150)  NOT NULL,              -- เก็บชื่อ ณ เวลาขาย
    unit_price      NUMERIC(10,2) NOT NULL CHECK (unit_price >= 0),
    qty             INT           NOT NULL CHECK (qty > 0),
    discount_amount NUMERIC(10,2) NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
    line_total      NUMERIC(12,2) NOT NULL,
    barber_id       BIGINT REFERENCES barbers(id) ON DELETE SET NULL,
    note            TEXT,
    created_at      TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT sale_item_ref CHECK (
        (kind = 'service' AND service_id IS NOT NULL) OR
        (kind = 'product' AND product_id IS NOT NULL)
    )
);
CREATE INDEX IF NOT EXISTS idx_sale_items_sale    ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_barber  ON sale_items(barber_id);

-- จ่ายได้หลายวิธีในบิลเดียว (split payment)
CREATE TABLE IF NOT EXISTS sale_payments (
    id          BIGSERIAL PRIMARY KEY,
    sale_id     BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    method      VARCHAR(20) NOT NULL
                CHECK (method IN ('cash','promptpay','card','transfer','points','other')),
    amount      NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    received    NUMERIC(12,2),                            -- เงินที่รับมาจริง (เงินสด)
    reference   VARCHAR(120),                             -- เลขอนุมัติบัตร / เลขอ้างอิงโอน
    payment_id  BIGINT REFERENCES payments(id) ON DELETE SET NULL,
    actor_id    BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

CREATE TABLE IF NOT EXISTS sale_refunds (
    id         BIGSERIAL PRIMARY KEY,
    sale_id    BIGINT NOT NULL REFERENCES sales(id) ON DELETE CASCADE,
    amount     NUMERIC(12,2) NOT NULL CHECK (amount > 0),
    method     VARCHAR(20)   NOT NULL DEFAULT 'cash',
    reason     TEXT,
    restock    BOOLEAN       NOT NULL DEFAULT TRUE,
    actor_id   BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_refunds_sale ON sale_refunds(sale_id);

-- ผูกการชำระ QR PromptPay เดิมเข้ากับบิล POS ได้
ALTER TABLE payments ADD COLUMN IF NOT EXISTS sale_id BIGINT REFERENCES sales(id) ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_payments_sale ON payments(sale_id);

-- เดิม service_id เป็น NOT NULL — บิล POS จ่าย QR อาจไม่ผูกบริการใดบริการหนึ่ง
ALTER TABLE payments ALTER COLUMN service_id DROP NOT NULL;

-- เพิ่มวิธีจ่ายที่ payments รองรับ
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD  CONSTRAINT payments_method_check
    CHECK (method IN ('promptpay','cash','manual','card','transfer'));

-- ---------------------------------------------------------------------
-- 4. สมาชิก / แต้มสะสม
-- ---------------------------------------------------------------------
ALTER TABLE users ADD COLUMN IF NOT EXISTS loyalty_points INT           NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS total_spent    NUMERIC(12,2) NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS visit_count    INT           NOT NULL DEFAULT 0;
ALTER TABLE users ADD COLUMN IF NOT EXISTS member_tier    VARCHAR(20)   NOT NULL DEFAULT 'bronze';
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthday       DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_visit_at  TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS loyalty_transactions (
    id            BIGSERIAL PRIMARY KEY,
    user_id       BIGINT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    points        INT    NOT NULL,                        -- + ได้รับ / - ใช้
    balance_after INT    NOT NULL,
    reason        VARCHAR(20) NOT NULL
                  CHECK (reason IN ('earn','redeem','adjust','expire','refund')),
    sale_id       BIGINT REFERENCES sales(id) ON DELETE SET NULL,
    note          TEXT,
    actor_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_loyalty_user ON loyalty_transactions(user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 5. โค้ดส่วนลด / โปรโมชัน
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS promo_codes (
    id             BIGSERIAL PRIMARY KEY,
    code           VARCHAR(30) NOT NULL UNIQUE,
    description    TEXT,
    discount_type  VARCHAR(10) NOT NULL CHECK (discount_type IN ('amount','percent')),
    discount_value NUMERIC(10,2) NOT NULL CHECK (discount_value > 0),
    min_total      NUMERIC(10,2) NOT NULL DEFAULT 0,
    max_discount   NUMERIC(10,2),
    max_uses       INT,
    used_count     INT NOT NULL DEFAULT 0,
    starts_at      TIMESTAMPTZ,
    ends_at        TIMESTAMPTZ,
    is_active      BOOLEAN NOT NULL DEFAULT TRUE,
    created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
DROP TRIGGER IF EXISTS trg_promo_updated ON promo_codes;
CREATE TRIGGER trg_promo_updated BEFORE UPDATE ON promo_codes
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ---------------------------------------------------------------------
-- 6. การจองล่วงหน้า (ลูกค้าจองผ่านเว็บ / LINE)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS appointments (
    id           BIGSERIAL PRIMARY KEY,
    customer_id  BIGINT REFERENCES users(id)    ON DELETE SET NULL,
    guest_name   VARCHAR(150),
    guest_phone  VARCHAR(20),
    service_id   BIGINT NOT NULL REFERENCES services(id) ON DELETE RESTRICT,
    barber_id    BIGINT REFERENCES barbers(id)  ON DELETE SET NULL,
    appoint_date DATE NOT NULL,
    appoint_time TIME NOT NULL,
    status       appointment_status NOT NULL DEFAULT 'confirmed',
    source       queue_source NOT NULL DEFAULT 'online',
    note         TEXT,
    ticket_id    BIGINT REFERENCES queue_tickets(id) ON DELETE SET NULL,
    reminded_at  TIMESTAMPTZ,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at   TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CONSTRAINT appointment_has_customer CHECK (customer_id IS NOT NULL OR guest_name IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_appoint_date     ON appointments(appoint_date, appoint_time);
CREATE INDEX IF NOT EXISTS idx_appoint_customer ON appointments(customer_id);
DROP TRIGGER IF EXISTS trg_appoint_updated ON appointments;
CREATE TRIGGER trg_appoint_updated BEFORE UPDATE ON appointments
    FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- ลูกค้าจองซ้ำช่วงเวลาเดิมไม่ได้
CREATE UNIQUE INDEX IF NOT EXISTS uniq_appoint_slot_customer
    ON appointments(customer_id, appoint_date, appoint_time)
    WHERE customer_id IS NOT NULL AND status IN ('pending','confirmed');

-- ---------------------------------------------------------------------
-- 7. ประวัติบทสนทนา LINE (ไว้ให้แอดมินตามดูย้อนหลัง)
-- ---------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS line_messages (
    id           BIGSERIAL PRIMARY KEY,
    line_user_id VARCHAR(64),
    user_id      BIGINT REFERENCES users(id) ON DELETE SET NULL,
    direction    VARCHAR(3) NOT NULL CHECK (direction IN ('in','out')),
    intent       VARCHAR(40),
    text         TEXT,
    created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_line_msg_user ON line_messages(line_user_id, created_at DESC);

-- ---------------------------------------------------------------------
-- 8. FUNCTIONS
-- ---------------------------------------------------------------------

-- เลขที่บิลอัตโนมัติ รีเซ็ตทุกวัน: INV-20261022-0001
CREATE OR REPLACE FUNCTION next_bill_no(p_date DATE DEFAULT CURRENT_DATE)
RETURNS VARCHAR AS $$
DECLARE
    v_seq INT;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('sale_seq_' || p_date::TEXT));

    SELECT COUNT(*) + 1 INTO v_seq FROM sales WHERE sale_date = p_date;

    RETURN ('INV-' || TO_CHAR(p_date, 'YYYYMMDD') || '-' || LPAD(v_seq::TEXT, 4, '0'))::VARCHAR;
END;
$$ LANGUAGE plpgsql;

-- ระดับสมาชิกจากยอดสะสม
CREATE OR REPLACE FUNCTION member_tier_for(p_total NUMERIC)
RETURNS VARCHAR AS $$
BEGIN
    RETURN CASE
        WHEN p_total >= 30000 THEN 'platinum'
        WHEN p_total >= 12000 THEN 'gold'
        WHEN p_total >=  4000 THEN 'silver'
        ELSE 'bronze'
    END;
END;
$$ LANGUAGE plpgsql IMMUTABLE;

-- คำนวณยอดรวมของบิลใหม่จากรายการในบิล (เรียกทุกครั้งที่แก้รายการ)
CREATE OR REPLACE FUNCTION recalc_sale(p_sale_id BIGINT)
RETURNS VOID AS $$
DECLARE
    v_sub      NUMERIC(12,2);
    v_disc     NUMERIC(12,2);
    v_s        sales%ROWTYPE;
    v_base     NUMERIC(12,2);
    v_tax      NUMERIC(12,2);
BEGIN
    SELECT * INTO v_s FROM sales WHERE id = p_sale_id;
    IF NOT FOUND THEN RETURN; END IF;

    SELECT COALESCE(SUM(line_total), 0) INTO v_sub
      FROM sale_items WHERE sale_id = p_sale_id;

    v_disc := CASE
        WHEN v_s.discount_type = 'percent' THEN ROUND(v_sub * LEAST(v_s.discount_value, 100) / 100, 2)
        WHEN v_s.discount_type = 'amount'  THEN LEAST(v_s.discount_value, v_sub)
        ELSE 0
    END;

    -- ส่วนลดจากแต้ม ใช้ได้ไม่เกินยอดที่เหลือ
    v_base := GREATEST(v_sub - v_disc - LEAST(v_s.points_discount, v_sub - v_disc), 0);
    v_tax  := ROUND(v_base * v_s.tax_rate / 100, 2);

    UPDATE sales
       SET subtotal        = v_sub,
           discount_amount = v_disc,
           tax_amount      = v_tax,
           total           = v_base + v_tax
     WHERE id = p_sale_id;
END;
$$ LANGUAGE plpgsql;

-- ---------------------------------------------------------------------
-- 9. VIEWS สำหรับรายงาน POS
-- ---------------------------------------------------------------------
CREATE OR REPLACE VIEW v_sale_detail AS
SELECT s.*,
       COALESCE(u.full_name, s.guest_name)  AS customer_name,
       COALESCE(u.phone,     s.guest_phone) AS customer_display_phone,
       u.member_tier,
       u.loyalty_points,
       c.full_name  AS cashier_name,
       bu.full_name AS barber_name,
       b.code       AS barber_code,
       q.ticket_no,
       (SELECT COUNT(*)::int FROM sale_items si WHERE si.sale_id = s.id) AS item_count
  FROM sales s
  LEFT JOIN users u          ON u.id  = s.customer_id
  LEFT JOIN users c          ON c.id  = s.cashier_id
  LEFT JOIN barbers b        ON b.id  = s.barber_id
  LEFT JOIN users bu         ON bu.id = b.user_id
  LEFT JOIN queue_tickets q  ON q.id  = s.ticket_id;

-- ยอดขายรายวัน
CREATE OR REPLACE VIEW v_sales_daily AS
SELECT sale_date,
       COUNT(*) FILTER (WHERE status IN ('paid','partial_refund','refunded'))::int AS bills,
       COALESCE(SUM(subtotal)        FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS subtotal,
       COALESCE(SUM(discount_amount) FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS discount,
       COALESCE(SUM(points_discount) FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS points_discount,
       COALESCE(SUM(total)           FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS total,
       COALESCE(SUM(refunded_amount) FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS refunded,
       COALESCE(SUM(total - refunded_amount) FILTER (WHERE status IN ('paid','partial_refund','refunded')), 0) AS net_total
  FROM sales
 GROUP BY sale_date;

-- สินค้า/บริการขายดี
CREATE OR REPLACE VIEW v_item_sales AS
SELECT si.kind,
       COALESCE(si.product_id, si.service_id) AS item_id,
       si.name,
       s.sale_date,
       SUM(si.qty)::int      AS qty,
       SUM(si.line_total)    AS revenue
  FROM sale_items si
  JOIN sales s ON s.id = si.sale_id
 WHERE s.status IN ('paid','partial_refund','refunded')
 GROUP BY si.kind, COALESCE(si.product_id, si.service_id), si.name, s.sale_date;

-- สรุปกะ
CREATE OR REPLACE VIEW v_shift_summary AS
SELECT sh.*,
       ou.full_name AS opened_by_name,
       cu.full_name AS closed_by_name,
       COALESCE(agg.bills, 0)        AS bills,
       COALESCE(agg.sales_total, 0)  AS sales_total,
       COALESCE(pay.cash_total, 0)   AS cash_total,
       COALESCE(pay.qr_total, 0)     AS qr_total,
       COALESCE(pay.card_total, 0)   AS card_total,
       COALESCE(pay.transfer_total, 0) AS transfer_total,
       COALESCE(pay.change_total, 0) AS change_total
  FROM cash_shifts sh
  LEFT JOIN users ou ON ou.id = sh.opened_by
  LEFT JOIN users cu ON cu.id = sh.closed_by
  LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS bills, COALESCE(SUM(total - refunded_amount), 0) AS sales_total
        FROM sales WHERE shift_id = sh.id AND status IN ('paid','partial_refund','refunded')
  ) agg ON TRUE
  LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'cash'), 0)      AS cash_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'promptpay'), 0) AS qr_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'card'), 0)      AS card_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'transfer'), 0)  AS transfer_total,
             COALESCE(SUM(s2.change_amount), 0)                                 AS change_total
        FROM sale_payments sp
        JOIN sales s2 ON s2.id = sp.sale_id
       WHERE s2.shift_id = sh.id AND s2.status IN ('paid','partial_refund','refunded')
  ) pay ON TRUE;

-- ยอดขาย/ค่ามือของช่าง
CREATE OR REPLACE VIEW v_barber_sales AS
SELECT b.id AS barber_id,
       b.code,
       u.full_name AS barber_name,
       s.sale_date,
       COUNT(DISTINCT s.id)::int AS bills,
       SUM(si.qty)::int          AS items,
       SUM(si.line_total)        AS revenue
  FROM sale_items si
  JOIN sales s    ON s.id = si.sale_id
  JOIN barbers b  ON b.id = si.barber_id
  LEFT JOIN users u ON u.id = b.user_id
 WHERE s.status IN ('paid','partial_refund','refunded')
 GROUP BY b.id, b.code, u.full_name, s.sale_date;

-- ---------------------------------------------------------------------
-- 10. ค่าตั้งต้นของร้าน (เพิ่มเฉพาะคีย์ที่ยังไม่มี)
-- ---------------------------------------------------------------------
INSERT INTO shop_settings (key, value, description) VALUES
  ('shop_phone',        '02-123-4567',                     'เบอร์โทรร้าน'),
  ('shop_address',      '123 ถนนสุขุมวิท แขวงคลองเตย เขตคลองเตย กรุงเทพฯ 10110', 'ที่อยู่ร้าน'),
  ('shop_map_url',      '',                                'ลิงก์แผนที่ Google Maps'),
  ('shop_tagline',      'Classic cuts, modern care.',      'สโลแกนร้าน'),
  ('open_days',         'จันทร์ - อาทิตย์',                 'วันเปิดทำการ'),
  ('tax_rate',          '0',                               'อัตราภาษี % (0 = ไม่คิด VAT)'),
  ('tax_id',            '',                                'เลขประจำตัวผู้เสียภาษีของร้าน'),
  ('receipt_footer',    'ขอบคุณที่ใช้บริการ แล้วพบกันใหม่ 💈', 'ข้อความท้ายใบเสร็จ'),
  ('points_per_baht',   '0.05',                            'ได้กี่แต้มต่อ 1 บาท (0.05 = 20 บาท 1 แต้ม)'),
  ('point_value_baht',  '1',                               '1 แต้มใช้แทนเงินได้กี่บาท'),
  ('min_points_redeem', '50',                              'ต้องมีแต้มขั้นต่ำเท่าไรจึงแลกได้'),
  ('loyalty_enabled',   'true',                            'เปิดใช้ระบบสะสมแต้ม'),
  ('booking_enabled',   'true',                            'เปิดให้จองคิวล่วงหน้า'),
  ('booking_slot_min',  '30',                              'ความถี่ของช่วงเวลาจอง (นาที)'),
  ('booking_max_days',  '14',                              'จองล่วงหน้าได้ไกลสุดกี่วัน')
ON CONFLICT (key) DO NOTHING;

COMMIT;
