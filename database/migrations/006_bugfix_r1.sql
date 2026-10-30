-- =====================================================================
--  Migration 006 : แก้บั๊กจากการทดสอบรอบ R1 (รันซ้ำได้ ไม่ลบข้อมูล)
--   1) คิวที่ถูกข้ามต้องไปต่อท้ายแถวจริง แม้เป็นคิวจองล่วงหน้า (priority สูง)
--   2) เงินทอนในสรุปกะนับซ้ำเมื่อบิลจ่ายหลายวิธี
--   3) คืนเงินสดต้องหักจากกะที่ทำรายการคืน ไม่ใช่กะที่ขาย
-- =====================================================================
BEGIN;

-- 1) เรียงตามจำนวนครั้งที่ถูกข้ามก่อน แล้วจึงดู priority
CREATE OR REPLACE FUNCTION reorder_queue(p_date DATE DEFAULT CURRENT_DATE)
RETURNS INT AS $$
DECLARE
    v_count INT;
BEGIN
    WITH ranked AS (
        SELECT id,
               ROW_NUMBER() OVER (ORDER BY skip_count ASC, priority DESC, issued_at ASC) AS rn
          FROM queue_tickets
         WHERE queue_date = p_date AND status = 'waiting'
    )
    UPDATE queue_tickets q
       SET position = r.rn
      FROM ranked r
     WHERE q.id = r.id AND q.position IS DISTINCT FROM r.rn;

    GET DIAGNOSTICS v_count = ROW_COUNT;

    UPDATE queue_tickets
       SET position = NULL
     WHERE queue_date = p_date AND status <> 'waiting' AND position IS NOT NULL;

    RETURN v_count;
END;
$$ LANGUAGE plpgsql;

-- 3) กะที่ทำรายการคืนเงิน
ALTER TABLE sale_refunds ADD COLUMN IF NOT EXISTS shift_id BIGINT REFERENCES cash_shifts(id);
UPDATE sale_refunds r
   SET shift_id = s.shift_id
  FROM sales s
 WHERE s.id = r.sale_id AND r.shift_id IS NULL;

-- 2) เงินทอนคิดแยกจาก sale_payments (บิลเดียวจ่ายหลายวิธี = ทอนครั้งเดียว)
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
       COALESCE(agg.change_total, 0) AS change_total
  FROM cash_shifts sh
  LEFT JOIN users ou ON ou.id = sh.opened_by
  LEFT JOIN users cu ON cu.id = sh.closed_by
  LEFT JOIN LATERAL (
      SELECT COUNT(*)::int AS bills,
             COALESCE(SUM(total - refunded_amount), 0) AS sales_total,
             COALESCE(SUM(change_amount), 0)           AS change_total
        FROM sales WHERE shift_id = sh.id AND status IN ('paid','partial_refund','refunded')
  ) agg ON TRUE
  LEFT JOIN LATERAL (
      SELECT COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'cash'), 0)      AS cash_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'promptpay'), 0) AS qr_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'card'), 0)      AS card_total,
             COALESCE(SUM(sp.amount) FILTER (WHERE sp.method = 'transfer'), 0)  AS transfer_total
        FROM sale_payments sp
        JOIN sales s2 ON s2.id = sp.sale_id
       WHERE s2.shift_id = sh.id AND s2.status IN ('paid','partial_refund','refunded')
  ) pay ON TRUE;

COMMIT;
