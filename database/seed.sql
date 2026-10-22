-- =====================================================================
--  seed.sql : ข้อมูลตัวอย่างสำหรับ ระบบเรียกคิวร้านตัดผม
--  รหัสผ่านทุกบัญชี : 123456
--  (hash ด้วย bcrypt ผ่าน pgcrypto -> ใช้ร่วมกับ bcryptjs ฝั่ง Node ได้)
-- =====================================================================
BEGIN;

TRUNCATE queue_events, notifications, queue_tickets, barber_services,
         services, service_categories, barbers, password_resets,
         refresh_tokens, users, shop_settings RESTART IDENTITY CASCADE;

-- ---------------------------------------------------------------------
-- ค่าคอนฟิกร้าน
-- ---------------------------------------------------------------------
INSERT INTO shop_settings (key, value, description) VALUES
  ('shop_name',          'Trim & Co.',  'ชื่อร้าน'),
  ('ticket_prefix',      'B',           'ตัวอักษรนำหน้าเลขคิว'),
  ('near_turn_threshold','2',           'เหลืออีกกี่คิวจึงแจ้งเตือน "ใกล้ถึงคิว"'),
  ('open_time',          '09:00',       'เวลาเปิดร้าน'),
  ('close_time',         '20:00',       'เวลาปิดร้าน');

-- ---------------------------------------------------------------------
-- ผู้ใช้งาน  (password = 123456)
-- ---------------------------------------------------------------------
INSERT INTO users (full_name, email, phone, password_hash, role, status) VALUES
  ('ผู้ดูแลระบบ',        'admin@trimco.local',  '0800000001', crypt('123456', gen_salt('bf', 10)), 'admin',    'active'),
  ('สมหญิง หน้าร้าน',    'staff@trimco.local',  '0800000002', crypt('123456', gen_salt('bf', 10)), 'staff',    'active'),
  ('ช่างเอก บัตเลอร์',   'barber1@trimco.local','0800000011', crypt('123456', gen_salt('bf', 10)), 'barber',   'active'),
  ('ช่างโบ๊ท เฟด',       'barber2@trimco.local','0800000012', crypt('123456', gen_salt('bf', 10)), 'barber',   'active'),
  ('ช่างมิ้น คัลเลอร์',  'barber3@trimco.local','0800000013', crypt('123456', gen_salt('bf', 10)), 'barber',   'active'),
  ('อริญชัย สุวรรณเกิด', 'arin@example.com',    '0812345678', crypt('123456', gen_salt('bf', 10)), 'customer', 'active'),
  ('ธนกร ใจดี',          'thanakorn@example.com','0819876543',crypt('123456', gen_salt('bf', 10)), 'customer', 'active'),
  ('ปวีณา ศรีสุข',       'paweena@example.com', '0865551234', crypt('123456', gen_salt('bf', 10)), 'customer', 'active'),
  ('กิตติ มั่นคง',       'kitti@example.com',   '0877778888', crypt('123456', gen_salt('bf', 10)), 'customer', 'active'),
  ('นภัส วงศ์ทอง',       'napat@example.com',   '0866662222', crypt('123456', gen_salt('bf', 10)), 'customer', 'active');

-- ---------------------------------------------------------------------
-- ช่างตัดผม
-- ---------------------------------------------------------------------
INSERT INTO barbers (user_id, code, nickname, specialty, status, rating, hired_at)
SELECT id, 'BB-01', 'เอก', 'Classic / Pompadour', 'available', 4.90, DATE '2022-05-01' FROM users WHERE email='barber1@trimco.local';
INSERT INTO barbers (user_id, code, nickname, specialty, status, rating, hired_at)
SELECT id, 'BB-02', 'โบ๊ท', 'Skin Fade / Buzz',   'available', 4.75, DATE '2023-01-15' FROM users WHERE email='barber2@trimco.local';
INSERT INTO barbers (user_id, code, nickname, specialty, status, rating, hired_at)
SELECT id, 'BB-03', 'มิ้น', 'ทำสีผม / ดัดผม',      'break',     4.85, DATE '2023-08-20' FROM users WHERE email='barber3@trimco.local';

-- ---------------------------------------------------------------------
-- ประเภทบริการ + บริการ
-- ---------------------------------------------------------------------
INSERT INTO service_categories (name, description, sort_order) VALUES
  ('ตัดผม',    'บริการตัดผมทุกทรง',        1),
  ('สระผม',    'สระ + นวดศีรษะ',           2),
  ('โกนหนวด',  'โกนหนวด / จัดทรงเครา',     3),
  ('ทำสีผม',   'ย้อมสี / ไฮไลต์',          4);

INSERT INTO services (category_id, name, description, duration_min, price) VALUES
  ((SELECT id FROM service_categories WHERE name='ตัดผม'),   'ตัดผมชายทั่วไป',   'ตัดผมทรงพื้นฐาน พร้อมจัดแต่งทรง',      30,  200.00),
  ((SELECT id FROM service_categories WHERE name='ตัดผม'),   'Skin Fade',        'ไล่ระดับด้านข้างจนถึงหนังศีรษะ',        45,  350.00),
  ((SELECT id FROM service_categories WHERE name='ตัดผม'),   'ตัดผมเด็ก',        'สำหรับเด็กอายุไม่เกิน 12 ปี',           25,  150.00),
  ((SELECT id FROM service_categories WHERE name='สระผม'),   'สระผม + นวดศีรษะ', 'สระผมพร้อมนวดผ่อนคลาย 15 นาที',        20,  120.00),
  ((SELECT id FROM service_categories WHERE name='สระผม'),   'ทรีตเมนต์บำรุงผม', 'บำรุงผมเสียด้วยทรีตเมนต์เข้มข้น',       40,  450.00),
  ((SELECT id FROM service_categories WHERE name='โกนหนวด'), 'โกนหนวดผ้าร้อน',   'Hot Towel Shave แบบดั้งเดิม',           30,  250.00),
  ((SELECT id FROM service_categories WHERE name='โกนหนวด'), 'จัดทรงเครา',       'เล็มและจัดรูปทรงเครา',                  20,  180.00),
  ((SELECT id FROM service_categories WHERE name='ทำสีผม'),  'ย้อมสีผมทั้งศีรษะ','เลือกสีได้ตามแคตตาล็อก',                90,  900.00),
  ((SELECT id FROM service_categories WHERE name='ทำสีผม'),  'ไฮไลต์',           'ทำไฮไลต์เฉพาะจุด',                     120, 1500.00);

-- ช่างทำบริการอะไรได้บ้าง
INSERT INTO barber_services (barber_id, service_id)
SELECT b.id, s.id FROM barbers b CROSS JOIN services s
 WHERE b.code IN ('BB-01','BB-02')
   AND s.name NOT IN ('ย้อมสีผมทั้งศีรษะ','ไฮไลต์');
INSERT INTO barber_services (barber_id, service_id)
SELECT b.id, s.id FROM barbers b CROSS JOIN services s WHERE b.code = 'BB-03';

-- ---------------------------------------------------------------------
-- คิวย้อนหลัง 14 วัน (สำหรับหน้า Report / Dashboard)
-- ---------------------------------------------------------------------
DO $$
DECLARE
    d          DATE;
    i          INT;
    n          INT;
    v_seq      INT;
    v_service  BIGINT;
    v_barber   BIGINT;
    v_cust     BIGINT;
    v_issued   TIMESTAMPTZ;
    v_wait     INT;
    v_dur      INT;
    v_ticket   BIGINT;
    v_status   queue_status;
BEGIN
    FOR d IN SELECT generate_series(CURRENT_DATE - 14, CURRENT_DATE - 1, INTERVAL '1 day')::DATE LOOP
        n := 8 + FLOOR(RANDOM() * 10)::INT;          -- 8-17 คิว/วัน
        FOR i IN 1..n LOOP
            v_seq  := i;
            SELECT id, duration_min INTO v_service, v_dur
              FROM services ORDER BY RANDOM() LIMIT 1;
            SELECT id INTO v_barber FROM barbers ORDER BY RANDOM() LIMIT 1;
            SELECT id INTO v_cust   FROM users WHERE role='customer' ORDER BY RANDOM() LIMIT 1;

            v_issued := d + TIME '09:00' + (i * INTERVAL '35 minutes');
            v_wait   := 5 + FLOOR(RANDOM() * 25)::INT;
            v_status := CASE WHEN RANDOM() < 0.85 THEN 'done'::queue_status
                             WHEN RANDOM() < 0.6  THEN 'cancelled'::queue_status
                             ELSE 'no_show'::queue_status END;

            INSERT INTO queue_tickets
                (ticket_no, queue_date, seq, customer_id, service_id, barber_id,
                 status, source, issued_at, called_at, started_at, finished_at,
                 cancelled_at, estimated_wait_min)
            VALUES
                ('B-' || LPAD(v_seq::TEXT, 3, '0'), d, v_seq, v_cust, v_service, v_barber,
                 v_status,
                 (ARRAY['walk_in','qr_code','online']::queue_source[])[1 + FLOOR(RANDOM()*3)::INT],
                 v_issued,
                 CASE WHEN v_status IN ('done')      THEN v_issued + (v_wait * INTERVAL '1 minute') END,
                 CASE WHEN v_status IN ('done')      THEN v_issued + ((v_wait + 2) * INTERVAL '1 minute') END,
                 CASE WHEN v_status = 'done'         THEN v_issued + ((v_wait + 2 + v_dur) * INTERVAL '1 minute') END,
                 CASE WHEN v_status = 'cancelled'    THEN v_issued + INTERVAL '10 minutes' END,
                 v_wait)
            RETURNING id INTO v_ticket;

            INSERT INTO queue_events (ticket_id, event_type, to_status, created_at)
            VALUES (v_ticket, 'issue', 'waiting', v_issued);
        END LOOP;
    END LOOP;
END $$;

-- ---------------------------------------------------------------------
-- คิวของ "วันนี้" : มีทั้งกำลังให้บริการ / เรียกแล้ว / รอ
-- ---------------------------------------------------------------------
DO $$
DECLARE
    v_ticket BIGINT;
    v_cust   BIGINT;
    v_svc    BIGINT;
BEGIN
    -- คิวที่เสร็จแล้ว 3 คิว
    FOR i IN 1..3 LOOP
        SELECT id INTO v_cust FROM users WHERE role='customer' ORDER BY RANDOM() LIMIT 1;
        SELECT id INTO v_svc  FROM services ORDER BY RANDOM() LIMIT 1;
        INSERT INTO queue_tickets (ticket_no, queue_date, seq, customer_id, service_id, barber_id,
                                   status, source, issued_at, called_at, started_at, finished_at)
        VALUES ('B-' || LPAD(i::TEXT,3,'0'), CURRENT_DATE, i, v_cust, v_svc,
                (SELECT id FROM barbers ORDER BY RANDOM() LIMIT 1), 'done', 'walk_in',
                NOW() - INTERVAL '4 hours' + (i * INTERVAL '20 minutes'),
                NOW() - INTERVAL '4 hours' + (i * INTERVAL '20 minutes') + INTERVAL '8 minutes',
                NOW() - INTERVAL '4 hours' + (i * INTERVAL '20 minutes') + INTERVAL '10 minutes',
                NOW() - INTERVAL '4 hours' + (i * INTERVAL '20 minutes') + INTERVAL '40 minutes');
    END LOOP;

    -- คิวที่กำลังให้บริการ
    INSERT INTO queue_tickets (ticket_no, queue_date, seq, customer_id, service_id, barber_id,
                               status, source, issued_at, called_at, started_at)
    VALUES ('B-004', CURRENT_DATE, 4,
            (SELECT id FROM users WHERE email='arin@example.com'),
            (SELECT id FROM services WHERE name='Skin Fade'),
            (SELECT id FROM barbers WHERE code='BB-01'),
            'serving', 'qr_code', NOW() - INTERVAL '50 minutes',
            NOW() - INTERVAL '25 minutes', NOW() - INTERVAL '22 minutes');
    UPDATE barbers SET status='serving' WHERE code='BB-01';

    -- คิวที่เรียกแล้ว รอเข้ารับบริการ
    INSERT INTO queue_tickets (ticket_no, queue_date, seq, customer_id, service_id, barber_id,
                               status, source, issued_at, called_at)
    VALUES ('B-005', CURRENT_DATE, 5,
            (SELECT id FROM users WHERE email='thanakorn@example.com'),
            (SELECT id FROM services WHERE name='ตัดผมชายทั่วไป'),
            (SELECT id FROM barbers WHERE code='BB-02'),
            'called', 'walk_in', NOW() - INTERVAL '35 minutes', NOW() - INTERVAL '2 minutes');

    -- คิวที่รออยู่ 4 คิว
    INSERT INTO queue_tickets (ticket_no, queue_date, seq, customer_id, guest_name, guest_phone,
                               service_id, status, source, issued_at, estimated_wait_min)
    VALUES
      ('B-006', CURRENT_DATE, 6, (SELECT id FROM users WHERE email='paweena@example.com'), NULL, NULL,
       (SELECT id FROM services WHERE name='สระผม + นวดศีรษะ'), 'waiting', 'online', NOW() - INTERVAL '20 minutes', 25),
      ('B-007', CURRENT_DATE, 7, (SELECT id FROM users WHERE email='kitti@example.com'), NULL, NULL,
       (SELECT id FROM services WHERE name='โกนหนวดผ้าร้อน'), 'waiting', 'qr_code', NOW() - INTERVAL '14 minutes', 40),
      ('B-008', CURRENT_DATE, 8, NULL, 'คุณวิชัย (Walk-in)', '0891112233',
       (SELECT id FROM services WHERE name='ตัดผมเด็ก'), 'waiting', 'walk_in', NOW() - INTERVAL '8 minutes', 55),
      ('B-009', CURRENT_DATE, 9, (SELECT id FROM users WHERE email='napat@example.com'), NULL, NULL,
       (SELECT id FROM services WHERE name='ย้อมสีผมทั้งศีรษะ'), 'waiting', 'online', NOW() - INTERVAL '3 minutes', 70);
END $$;

-- จัดลำดับคิวอัตโนมัติของวันนี้
SELECT reorder_queue(CURRENT_DATE);

-- ---------------------------------------------------------------------
-- แจ้งเตือนตัวอย่าง
-- ---------------------------------------------------------------------
INSERT INTO notifications (user_id, ticket_id, type, title, message)
SELECT q.customer_id, q.id, 'your_turn', 'ถึงคิวของคุณแล้ว',
       'คิว ' || q.ticket_no || ' เชิญที่เก้าอี้ช่าง ' || COALESCE(b.nickname,'-')
  FROM queue_tickets q LEFT JOIN barbers b ON b.id = q.barber_id
 WHERE q.queue_date = CURRENT_DATE AND q.status = 'called' AND q.customer_id IS NOT NULL;

INSERT INTO notifications (user_id, ticket_id, type, title, message)
SELECT q.customer_id, q.id, 'near_turn', 'ใกล้ถึงคิวของคุณแล้ว',
       'คิว ' || q.ticket_no || ' เหลืออีก ' || COALESCE(q.position,0) - 1 || ' คิว กรุณาเตรียมตัว'
  FROM queue_tickets q
 WHERE q.queue_date = CURRENT_DATE AND q.status = 'waiting'
   AND q.customer_id IS NOT NULL AND q.position <= 2;

COMMIT;

-- สรุปผล
SELECT 'users' AS table_name, COUNT(*) FROM users
UNION ALL SELECT 'barbers',       COUNT(*) FROM barbers
UNION ALL SELECT 'services',      COUNT(*) FROM services
UNION ALL SELECT 'queue_tickets', COUNT(*) FROM queue_tickets
UNION ALL SELECT 'notifications', COUNT(*) FROM notifications;
