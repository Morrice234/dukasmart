const express = require('express');
const { query, transaction } = require('../db');
const { HttpError, normalizePhone } = require('../utils');
const { uniqueCode, normalizeCode, resolveCode, recordReferral } = require('../services/referrals');
const { getSettings, saveSettings } = require('../services/settings');

// Mounted under /api/admin, after requireAdmin
const router = express.Router();

router.get('/settings', async (req, res) => {
  res.json({ settings: await getSettings() });
});

router.put('/settings', async (req, res) => {
  res.json({ settings: await saveSettings(req.body || {}) });
});

// ---------- Agents (friends who bring in customers) ----------

router.get('/agents', async (req, res) => {
  const { rows } = await query(`
    SELECT a.*,
           count(DISTINCT r.id)::int AS signups,
           count(DISTINCT r.id) FILTER (WHERE r.status = 'converted')::int AS conversions,
           COALESCE(sum(rw.amount) FILTER (WHERE rw.kind = 'cash' AND rw.status = 'pending'), 0)::int AS pending_cash,
           COALESCE(sum(rw.amount) FILTER (WHERE rw.kind = 'cash' AND rw.status = 'paid'), 0)::int AS paid_cash,
           (SELECT count(*)::int FROM leads l WHERE l.agent_id = a.id AND l.status NOT IN ('converted', 'lost')) AS open_leads
      FROM agents a
      LEFT JOIN referrals r ON r.referrer_agent = a.id
      LEFT JOIN referral_rewards rw ON rw.referral_id = r.id
     GROUP BY a.id
     ORDER BY a.is_active DESC, conversions DESC, a.name`);
  res.json({ agents: rows });
});

router.post('/agents', async (req, res) => {
  const { name, phone, code, notes } = req.body || {};
  const p = normalizePhone(phone);
  if (!name || !String(name).trim()) throw new HttpError(400, 'Agent name is required');
  if (!p) throw new HttpError(400, 'Enter a valid M-Pesa number for payouts');
  let finalCode = normalizeCode(code);
  if (finalCode) {
    if (finalCode.length < 4 || finalCode.length > 12) throw new HttpError(400, 'Code must be 4 to 12 letters or digits');
    if (await resolveCode({ query }, finalCode)) throw new HttpError(409, 'That code is already taken');
  } else {
    finalCode = await uniqueCode({ query });
  }
  const dup = (await query('SELECT 1 FROM agents WHERE phone = $1', [p])).rows[0];
  if (dup) throw new HttpError(409, 'An agent with this phone already exists');
  const { rows } = await query(
    'INSERT INTO agents (name, phone, code, notes) VALUES ($1, $2, $3, $4) RETURNING *',
    [String(name).trim(), p, finalCode, notes || null]
  );
  res.status(201).json({ agent: rows[0] });
});

router.patch('/agents/:id', async (req, res) => {
  const { name, notes, isActive } = req.body || {};
  const { rows } = await query(
    `UPDATE agents SET name = COALESCE($2, name), notes = COALESCE($3, notes), is_active = COALESCE($4, is_active)
      WHERE id = $1 RETURNING *`,
    [req.params.id, name || null, notes === undefined ? null : notes, isActive === undefined ? null : Boolean(isActive)]
  );
  if (!rows[0]) throw new HttpError(404, 'Agent not found');
  res.json({ agent: rows[0] });
});

// ---------- Referrals ----------

router.get('/referrals', async (req, res) => {
  const { type, status } = req.query;
  const where = [];
  const params = [];
  if (['business', 'agent'].includes(type)) { params.push(type); where.push(`r.referrer_type = $${params.length}`); }
  if (['signed_up', 'converted'].includes(status)) { params.push(status); where.push(`r.status = $${params.length}`); }
  const { rows } = await query(`
    SELECT r.*, rb.name AS referee_name, rb.phone AS referee_phone,
           COALESCE(ref_b.name, a.name) AS referrer_name,
           COALESCE((SELECT sum(amount) FROM referral_rewards x WHERE x.referral_id = r.id AND x.kind = 'cash'), 0)::int AS cash_total,
           COALESCE((SELECT sum(amount) FROM referral_rewards x WHERE x.referral_id = r.id AND x.kind = 'days'), 0)::int AS days_total
      FROM referrals r
      JOIN businesses rb ON rb.id = r.referee_id
      LEFT JOIN businesses ref_b ON ref_b.id = r.referrer_business
      LEFT JOIN agents a ON a.id = r.referrer_agent
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY r.created_at DESC LIMIT 300`, params);
  res.json({ referrals: rows });
});

// Link a business to a referrer after the fact, e.g. the agent forgot to give the code
router.post('/referrals/attach', async (req, res) => {
  const { businessId, code } = req.body || {};
  const ref = await resolveCode({ query }, code);
  if (!ref) throw new HttpError(404, 'Code not found');
  if (ref.type === 'business' && ref.id === businessId) throw new HttpError(400, 'A business cannot refer itself');
  const existing = (await query('SELECT 1 FROM referrals WHERE referee_id = $1', [businessId])).rows[0];
  if (existing) throw new HttpError(409, 'This business already has a referrer');
  await transaction(async (client) => {
    await recordReferral(client, businessId, ref);
    // If they already paid before being linked, count it as converted now (bonus applies on their next payment)
    const paid = (await client.query(`SELECT 1 FROM payments WHERE business_id = $1 AND status = 'success' LIMIT 1`, [businessId])).rows[0];
    if (paid) await client.query(`UPDATE referrals SET status = 'converted', converted_at = now() WHERE referee_id = $1`, [businessId]);
  });
  res.status(201).json({ ok: true });
});

// ---------- Rewards and payouts ----------

router.get('/rewards', async (req, res) => {
  const { status = '', kind = '' } = req.query;
  const where = [];
  const params = [];
  if (status) { params.push(status); where.push(`rw.status = $${params.length}`); }
  if (kind) { params.push(kind); where.push(`rw.kind = $${params.length}`); }
  const { rows } = await query(`
    SELECT rw.*, r.referrer_type, rb.name AS referee_name,
           COALESCE(ref_b.name, a.name) AS referrer_name, COALESCE(ref_b.phone, a.phone) AS referrer_phone, a.id AS agent_id
      FROM referral_rewards rw
      JOIN referrals r ON r.id = rw.referral_id
      JOIN businesses rb ON rb.id = r.referee_id
      LEFT JOIN businesses ref_b ON ref_b.id = r.referrer_business
      LEFT JOIN agents a ON a.id = r.referrer_agent
      ${where.length ? `WHERE ${where.join(' AND ')}` : ''}
     ORDER BY rw.created_at DESC LIMIT 300`, params);
  res.json({ rewards: rows });
});

// Body: { paidRef } e.g. the M-Pesa code you sent the agent
router.post('/rewards/:id/pay', async (req, res) => {
  const { rows } = await query(
    `UPDATE referral_rewards SET status = 'paid', paid_ref = $2, paid_at = now()
      WHERE id = $1 AND kind = 'cash' AND status = 'pending' RETURNING *`,
    [req.params.id, (req.body && req.body.paidRef) || null]
  );
  if (!rows[0]) throw new HttpError(400, 'Only pending cash rewards can be marked paid');
  res.json({ reward: rows[0] });
});

router.post('/rewards/:id/void', async (req, res) => {
  const { rows } = await query(
    `UPDATE referral_rewards SET status = 'void' WHERE id = $1 AND status = 'pending' RETURNING *`, [req.params.id]
  );
  if (!rows[0]) throw new HttpError(400, 'Only pending rewards can be voided');
  res.json({ reward: rows[0] });
});

// Pay everything an agent is owed in one M-Pesa send
router.post('/agents/:id/payout', async (req, res) => {
  const { rows } = await query(
    `UPDATE referral_rewards rw SET status = 'paid', paid_ref = $2, paid_at = now()
       FROM referrals r
      WHERE rw.referral_id = r.id AND r.referrer_agent = $1 AND rw.kind = 'cash' AND rw.status = 'pending'
      RETURNING rw.amount`,
    [req.params.id, (req.body && req.body.paidRef) || null]
  );
  res.json({ paidCount: rows.length, paidTotal: rows.reduce((n, r) => n + r.amount, 0) });
});

module.exports = router;
