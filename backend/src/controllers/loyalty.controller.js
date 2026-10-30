/**
 * Module: สมาชิกสะสมแต้ม
 *
 *   GET  /api/loyalty/me              แต้มและประวัติของฉัน
 *   GET  /api/loyalty/:userId         แต้มและประวัติของลูกค้า (พนักงาน)
 *   POST /api/loyalty/:userId/adjust  ปรับแต้มด้วยมือ (แอดมิน)
 */
import { query, withTransaction } from '../db.js';
import { ApiError, asyncHandler } from '../utils/http.js';
import { validate } from '../utils/validate.js';
import { loyaltyConfig } from '../utils/settings.js';

const TIERS = {
  bronze: { label: 'Bronze', next: 'silver', threshold: 4000 },
  silver: { label: 'Silver', next: 'gold', threshold: 12000 },
  gold: { label: 'Gold', next: 'platinum', threshold: 30000 },
  platinum: { label: 'Platinum', next: null, threshold: null },
};

async function summaryFor(userId) {
  const { rows } = await query(
    `SELECT id, full_name, email, phone, loyalty_points, total_spent, visit_count,
            member_tier, last_visit_at, birthday
       FROM users WHERE id = $1`,
    [userId],
  );
  const user = rows[0];
  if (!user) throw ApiError.notFound('ไม่พบผู้ใช้นี้');

  const { rows: history } = await query(
    `SELECT l.*, s.bill_no
       FROM loyalty_transactions l
       LEFT JOIN sales s ON s.id = l.sale_id
      WHERE l.user_id = $1 ORDER BY l.created_at DESC LIMIT 50`,
    [userId],
  );

  const cfg = await loyaltyConfig();
  const tier = TIERS[user.member_tier] || TIERS.bronze;

  return {
    user,
    history,
    config: cfg,
    tier: {
      key: user.member_tier,
      label: tier.label,
      next: tier.next ? TIERS[tier.next].label : null,
      // ยอดที่ต้องใช้จ่ายเพิ่มเพื่อเลื่อนระดับ
      spend_to_next: tier.threshold === null ? null : Math.max(tier.threshold - Number(user.total_spent), 0),
    },
    redeemable_baht: Math.floor(user.loyalty_points * cfg.pointValueBaht),
    can_redeem: cfg.enabled && user.loyalty_points >= cfg.minRedeem,
  };
}

export const myLoyalty = asyncHandler(async (req, res) => {
  res.json(await summaryFor(req.user.id));
});

export const customerLoyalty = asyncHandler(async (req, res) => {
  res.json(await summaryFor(req.params.userId));
});

export const adjustPoints = asyncHandler(async (req, res) => {
  const d = validate(req.body, {
    points: { type: 'int', required: true, label: 'จำนวนแต้ม' },
    note: { type: 'string', required: true, max: 300, label: 'เหตุผล' },
  });
  if (d.points === 0) throw ApiError.badRequest('จำนวนแต้มต้องไม่เป็น 0');

  const balance = await withTransaction(async (client) => {
    const { rows } = await client.query(
      'SELECT id, loyalty_points FROM users WHERE id = $1 FOR UPDATE', [req.params.userId],
    );
    if (!rows[0]) throw ApiError.notFound('ไม่พบผู้ใช้นี้');
    if (rows[0].loyalty_points + d.points < 0) {
      throw ApiError.badRequest(`ลูกค้ามีแต้มคงเหลือ ${rows[0].loyalty_points} แต้ม หักเพิ่มไม่ได้`);
    }

    const { rows: updated } = await client.query(
      'UPDATE users SET loyalty_points = loyalty_points + $2 WHERE id = $1 RETURNING loyalty_points',
      [req.params.userId, d.points],
    );
    await client.query(
      `INSERT INTO loyalty_transactions (user_id, points, balance_after, reason, note, actor_id)
       VALUES ($1,$2,$3,'adjust',$4,$5)`,
      [req.params.userId, d.points, updated[0].loyalty_points, d.note, req.user.id],
    );
    return updated[0].loyalty_points;
  });

  res.json({
    loyalty_points: balance,
    message: `${d.points > 0 ? 'เพิ่ม' : 'หัก'}แต้ม ${Math.abs(d.points)} แต้ม · คงเหลือ ${balance} แต้ม`,
  });
});

/** GET /api/loyalty — อันดับลูกค้าที่ใช้จ่ายสูงสุด (พนักงาน) */
export const topCustomers = asyncHandler(async (req, res) => {
  const limit = Math.min(Number(req.query.limit) || 20, 100);
  const { rows } = await query(
    `SELECT id, full_name, phone, email, member_tier, loyalty_points, total_spent,
            visit_count, last_visit_at
       FROM users
      WHERE role = 'customer' AND (total_spent > 0 OR loyalty_points > 0)
      ORDER BY total_spent DESC, loyalty_points DESC
      LIMIT ${limit}`,
  );
  res.json({ data: rows });
});
