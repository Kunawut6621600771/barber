import { useCallback, useEffect, useMemo, useState } from 'react';
import { api } from '../api/client.js';
import { useToast } from '../context/ToastContext.jsx';
import { useAuth } from '../context/AuthContext.jsx';
import {
  Card, Modal, Field, Empty, Loading, Stat, Avatar, baht, dateOf, dateTimeOf,
} from '../components/ui.jsx';

const TIER_LABEL = { bronze: 'Bronze', silver: 'Silver', gold: 'Gold', platinum: 'Platinum' };

const REASON_LABEL = {
  earn: 'ได้รับจากการใช้บริการ',
  redeem: 'ใช้แลกส่วนลด',
  adjust: 'ปรับโดยผู้ดูแล',
  expire: 'แต้มหมดอายุ',
  refund: 'ปรับจากการคืนเงิน',
};

export function TierBadge({ tier }) {
  return <span className={`tier ${tier || 'bronze'}`}>{TIER_LABEL[tier] || tier}</span>;
}

export default function Members() {
  const toast = useToast();
  const { user } = useAuth();

  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [tier, setTier] = useState('');
  const [detail, setDetail] = useState(null);
  const [adjustFor, setAdjustFor] = useState(null);

  const load = useCallback(async () => {
    try {
      setList((await api.get('/loyalty', { limit: 100 })).data);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return list.filter((m) => (!tier || m.member_tier === tier)
      && (!q || m.full_name.toLowerCase().includes(q)
        || (m.phone || '').includes(q) || (m.email || '').toLowerCase().includes(q)));
  }, [list, search, tier]);

  const totals = useMemo(() => ({
    members: list.length,
    points: list.reduce((s, m) => s + m.loyalty_points, 0),
    spent: list.reduce((s, m) => s + Number(m.total_spent), 0),
    visits: list.reduce((s, m) => s + m.visit_count, 0),
  }), [list]);

  const openDetail = async (member) => {
    try {
      setDetail(await api.get(`/loyalty/${member.id}`));
    } catch (err) {
      toast.error(err.message);
    }
  };

  if (loading) return <div className="page"><Loading rows={6} /></div>;

  return (
    <div className="page">
      <div className="page-head">
        <h1>สมาชิกและแต้มสะสม</h1>
        <div className="sub">ลูกค้าที่เคยใช้บริการ เรียงตามยอดใช้จ่ายสะสม</div>
      </div>

      <div className="kpi-row" style={{ marginBottom: 16 }}>
        <Stat label="สมาชิกที่มียอดสะสม" value={totals.members} unit="คน" icon="👥" />
        <Stat label="แต้มคงเหลือรวม" value={totals.points.toLocaleString('th-TH')} unit="แต้ม" icon="⭐" />
        <Stat label="ยอดใช้จ่ายสะสม" value={baht(totals.spent)} icon="💰" />
        <Stat label="จำนวนครั้งที่ใช้บริการ" value={totals.visits.toLocaleString('th-TH')} unit="ครั้ง" icon="✂" />
      </div>

      <Card tight>
        <div className="row gap-2 wrap" style={{ marginBottom: 12 }}>
          <input
            className="input"
            style={{ maxWidth: 260 }}
            placeholder="ค้นหาชื่อ เบอร์ หรืออีเมล..."
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <div className="chips">
            <button className={`chip ${!tier ? 'active' : ''}`} onClick={() => setTier('')}>ทุกระดับ</button>
            {Object.entries(TIER_LABEL).map(([k, v]) => (
              <button key={k} className={`chip ${tier === k ? 'active' : ''}`} onClick={() => setTier(k)}>{v}</button>
            ))}
          </div>
        </div>

        {shown.length === 0 ? (
          <Empty icon="👤" title="ยังไม่มีสมาชิกที่ตรงเงื่อนไข" hint="สมาชิกจะปรากฏที่นี่หลังมีการขายผ่าน POS" />
        ) : (
          <div className="table-wrap">
            <table className="data">
              <thead>
                <tr>
                  <th>#</th><th>ลูกค้า</th><th>ระดับ</th>
                  <th className="right">แต้มคงเหลือ</th><th className="right">ยอดสะสม</th>
                  <th className="right">มาแล้ว</th><th>มาล่าสุด</th><th />
                </tr>
              </thead>
              <tbody>
                {shown.map((m, i) => (
                  <tr key={m.id}>
                    <td className="muted mono">{i + 1}</td>
                    <td>
                      <div className="row gap-2">
                        <Avatar name={m.full_name} size="sm" />
                        <div>
                          <div className="bold">{m.full_name}</div>
                          <div className="tiny muted">{m.phone || m.email}</div>
                        </div>
                      </div>
                    </td>
                    <td><TierBadge tier={m.member_tier} /></td>
                    <td className="right mono bold">{m.loyalty_points.toLocaleString('th-TH')}</td>
                    <td className="right mono">{baht(m.total_spent)}</td>
                    <td className="right mono">{m.visit_count}</td>
                    <td className="tiny muted">{m.last_visit_at ? dateOf(m.last_visit_at) : '—'}</td>
                    <td>
                      <div className="actions">
                        <button className="btn sm" onClick={() => openDetail(m)}>ดู</button>
                        {user.role === 'admin' && (
                          <button className="btn sm" onClick={() => setAdjustFor(m)}>ปรับแต้ม</button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      <Modal
        open={!!detail}
        wide
        title={detail?.user?.full_name || ''}
        onClose={() => setDetail(null)}
        footer={<button className="btn dark" onClick={() => setDetail(null)}>ปิด</button>}
      >
        {detail && (
          <>
            <div className="kpi-row" style={{ marginBottom: 16 }}>
              <Stat label="แต้มคงเหลือ" value={detail.user.loyalty_points} unit="แต้ม" />
              <Stat label="ใช้แทนเงินได้" value={baht(detail.redeemable_baht)} />
              <Stat label="ยอดสะสม" value={baht(detail.user.total_spent)} />
              <Stat label="มาแล้ว" value={detail.user.visit_count} unit="ครั้ง" />
            </div>

            <div className="dl" style={{ marginBottom: 16 }}>
              <dt>ระดับสมาชิก</dt><dd><TierBadge tier={detail.tier.key} /></dd>
              {detail.tier.next && (
                <>
                  <dt>อีก {baht(detail.tier.spend_to_next)} จะได้ระดับ</dt>
                  <dd>{detail.tier.next}</dd>
                </>
              )}
              <dt>เบอร์โทร</dt><dd>{detail.user.phone || '—'}</dd>
              <dt>อีเมล</dt><dd>{detail.user.email}</dd>
              <dt>มาล่าสุด</dt><dd>{detail.user.last_visit_at ? dateTimeOf(detail.user.last_visit_at) : '—'}</dd>
            </div>

            <div className="divider">ประวัติแต้ม</div>
            {detail.history.length === 0 ? <Empty icon="⭐" title="ยังไม่มีประวัติแต้ม" /> : (
              <div className="table-wrap">
                <table className="data">
                  <thead><tr><th>เวลา</th><th>รายการ</th><th className="right">แต้ม</th><th className="right">คงเหลือ</th></tr></thead>
                  <tbody>
                    {detail.history.map((h) => (
                      <tr key={h.id}>
                        <td className="tiny">{dateTimeOf(h.created_at)}</td>
                        <td>
                          <div className="small">{REASON_LABEL[h.reason] || h.reason}</div>
                          {(h.note || h.bill_no) && (
                            <div className="tiny muted">{h.bill_no ? `บิล ${h.bill_no}` : ''}{h.note ? ` · ${h.note}` : ''}</div>
                          )}
                        </td>
                        <td className="right mono bold" style={{ color: h.points > 0 ? 'var(--ok)' : 'var(--brand)' }}>
                          {h.points > 0 ? '+' : ''}{h.points}
                        </td>
                        <td className="right mono">{h.balance_after}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
      </Modal>

      <AdjustModal
        member={adjustFor}
        onClose={() => setAdjustFor(null)}
        onDone={() => { setAdjustFor(null); load(); }}
        toast={toast}
      />
    </div>
  );
}

function AdjustModal({ member, onClose, onDone, toast }) {
  const [points, setPoints] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => { if (member) { setPoints(''); setNote(''); } }, [member]);
  if (!member) return null;

  const n = Number(points) || 0;
  const after = member.loyalty_points + n;

  const submit = async () => {
    setBusy(true);
    try {
      toast.success((await api.post(`/loyalty/${member.id}/adjust`, { points: n, note })).message);
      onDone();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open
      title={`ปรับแต้ม: ${member.full_name}`}
      onClose={onClose}
      footer={(
        <>
          <button className="btn" onClick={onClose} disabled={busy}>ยกเลิก</button>
          <button className="btn primary" onClick={submit} disabled={busy || n === 0 || after < 0 || !note.trim()}>
            {busy && <span className="spinner" />}บันทึก
          </button>
        </>
      )}
    >
      <div className="dl" style={{ marginBottom: 14 }}>
        <dt>แต้มคงเหลือ</dt><dd>{member.loyalty_points} แต้ม</dd>
        <dt>หลังปรับ</dt><dd style={{ color: after < 0 ? 'var(--brand)' : 'var(--ok)' }}>{after} แต้ม</dd>
      </div>

      <Field label="จำนวนแต้ม" hint="ใส่ค่าลบเพื่อหักแต้ม เช่น -100">
        <input className="input" type="number" value={points} onChange={(e) => setPoints(e.target.value)} />
      </Field>
      <Field label="เหตุผล (จำเป็น)" hint="บันทึกไว้ในประวัติเพื่อตรวจสอบย้อนหลังได้">
        <input className="input" value={note} onChange={(e) => setNote(e.target.value)} placeholder="เช่น ชดเชยบริการที่ผิดพลาด" />
      </Field>
    </Modal>
  );
}
