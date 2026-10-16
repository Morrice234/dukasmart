// Agent portal: field agents sign in with their phone and a PIN the office gives them,
// then see their invite link, downloads, sign-ups, paid shops, earnings and leads.
const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { HttpError, normalizePhone, subscriptionInfo } = require('../utils');
const { inviteLink } = require('../services/release');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 });

function signAgent(agent) {
  return jwt.sign({ aid: agent.id, role: 'agent' }, process.env.JWT_SECRET, { expiresIn: '30d' });
}

async function requireAgent(req, res, next) {
  const h = req.headers.authorization || '';
  const token = h.startsWith('Bearer ') ? h.slice(7) : null;
  if (!token) throw new HttpError(401, 'Please sign in');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Your session has ended, please sign in again');
  }
  if (payload.role !== 'agent' || !payload.aid) throw new HttpError(401, 'Please sign in');
  const agent = (await query('SELECT * FROM agents WHERE id = $1', [payload.aid])).rows[0];
  if (!agent || !agent.is_active) throw new HttpError(403, 'Your agent account is not active. Talk to your supervisor.');
  req.agent = agent;
  next();
}

router.post('/login', limiter, async (req, res) => {
  const { phone, pin } = req.body || {};
  const p = normalizePhone(phone);
  const wrong = new HttpError(401, 'Wrong phone number or PIN');
  if (!p) throw wrong;
  const agent = (await query('SELECT * FROM agents WHERE phone = $1', [p])).rows[0];
  if (!agent || !agent.pin_hash) {
    if (agent) throw new HttpError(403, 'Your portal PIN has not been set yet. Ask your supervisor for it.');
    throw wrong;
  }
  if (!(await bcrypt.compare(String(pin || ''), agent.pin_hash))) throw wrong;
  if (!agent.is_active) throw new HttpError(403, 'Your agent account is not active. Talk to your supervisor.');
  query('UPDATE agents SET last_login_at = now() WHERE id = $1', [agent.id]).catch(() => {});
  res.json({ token: signAgent(agent) });
});

// Everything the portal shows, in one call
router.get('/me', requireAgent, async (req, res) => {
  const a = req.agent;

  const downloads = (await query(`
    SELECT count(*)::int AS total,
           count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS month,
           count(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS week
      FROM app_downloads WHERE upper(code) = upper($1)`, [a.code])).rows[0];

  const counts = (await query(`
    SELECT count(*)::int AS signups,
           count(*) FILTER (WHERE created_at >= date_trunc('month', now()))::int AS signups_month,
           count(*) FILTER (WHERE created_at >= date_trunc('week', now()))::int AS signups_week,
           count(*) FILTER (WHERE status = 'converted')::int AS paid,
           count(*) FILTER (WHERE status = 'converted' AND converted_at >= date_trunc('month', now()))::int AS paid_month
      FROM referrals WHERE referrer_agent = $1`, [a.id])).rows[0];

  const money = (await query(`
    SELECT COALESCE(sum(rw.amount) FILTER (WHERE rw.status = 'pending'), 0)::int AS pending,
           COALESCE(sum(rw.amount) FILTER (WHERE rw.status = 'paid'), 0)::int AS paid,
           COALESCE(sum(rw.amount) FILTER (WHERE rw.status IN ('pending', 'paid') AND rw.created_at >= date_trunc('month', now())), 0)::int AS month
      FROM referral_rewards rw JOIN referrals r ON r.id = rw.referral_id
     WHERE r.referrer_agent = $1 AND rw.kind = 'cash'`, [a.id])).rows[0];

  // Shops they brought in, with what the agent needs for follow-up: trial end and when the app was last used
  const shops = (await query(`
    SELECT b.name, b.owner_name, b.location, b.phone, b.status, b.trial_ends_at, b.subscription_ends_at, b.plan_code,
           b.last_sync_at, r.status AS referral_status, r.created_at AS joined_at, r.converted_at,
           COALESCE((SELECT sum(rw.amount) FROM referral_rewards rw WHERE rw.referral_id = r.id AND rw.kind = 'cash' AND rw.status <> 'void'), 0)::int AS earned
      FROM referrals r JOIN businesses b ON b.id = r.referee_id
     WHERE r.referrer_agent = $1
     ORDER BY r.created_at DESC LIMIT 200`, [a.id])).rows.map((b) => {
    const sub = subscriptionInfo(b);
    const idleDays = b.last_sync_at ? Math.floor((Date.now() - new Date(b.last_sync_at).getTime()) / 864e5) : null;
    return {
      name: b.name,
      owner: b.owner_name,
      location: b.location,
      phone: b.phone,
      state: sub.state, // trial | active | expired | suspended
      endsAt: sub.endsAt,
      lastActiveAt: b.last_sync_at,
      // Needs a visit: on trial or paying but not used for 2+ days, or trial ending within 2 days
      atRisk: (sub.state === 'trial' || sub.state === 'active') && (idleDays === null || idleDays >= 2
        || (sub.state === 'trial' && new Date(sub.endsAt).getTime() - Date.now() < 2 * 864e5)),
      paid: b.referral_status === 'converted',
      joinedAt: b.joined_at,
      earned: b.earned,
    };
  });

  const payouts = (await query(`
    SELECT paid_ref, max(paid_at) AS paid_at, sum(rw.amount)::int AS amount, count(*)::int AS shops
      FROM referral_rewards rw JOIN referrals r ON r.id = rw.referral_id
     WHERE r.referrer_agent = $1 AND rw.kind = 'cash' AND rw.status = 'paid'
     GROUP BY paid_ref, date_trunc('minute', rw.paid_at)
     ORDER BY max(paid_at) DESC LIMIT 20`, [a.id])).rows;

  const weekly = (await query(`
    SELECT to_char(w, 'YYYY-MM-DD') AS week,
           (SELECT count(*)::int FROM referrals r WHERE r.referrer_agent = $1 AND r.created_at >= w AND r.created_at < w + interval '7 days') AS signups,
           (SELECT count(*)::int FROM referrals r WHERE r.referrer_agent = $1 AND r.converted_at >= w AND r.converted_at < w + interval '7 days') AS paid
      FROM generate_series(date_trunc('week', now()) - interval '7 weeks', date_trunc('week', now()), interval '1 week') w
     ORDER BY w`, [a.id])).rows;

  const leads = (await query(`
    SELECT id, business_name, contact_name, phone, location, interest, status, objection, next_follow_up, created_at
      FROM leads WHERE agent_id = $1 AND status NOT IN ('converted', 'lost')
     ORDER BY next_follow_up NULLS LAST, created_at DESC LIMIT 100`, [a.id])).rows;

  const rate = (await query(`SELECT value FROM settings WHERE key = 'agent_conversion_cash'`)).rows[0];

  res.json({
    agent: { name: a.name, phone: a.phone, code: a.code },
    inviteLink: inviteLink(a.code),
    ratePerPaidShop: rate ? Number(rate.value) : null,
    downloads, counts, money, shops, payouts, weekly, leads,
  });
});

// An agent records a shop that is interested but not ready yet
router.post('/leads', requireAgent, async (req, res) => {
  const b = req.body || {};
  const name = String(b.businessName || '').trim();
  if (!name) throw new HttpError(400, 'Business name is required');
  const phone = b.phone ? normalizePhone(b.phone) : null;
  if (b.phone && !phone) throw new HttpError(400, 'Enter a valid phone number, e.g. 0712345678');
  if (phone) {
    const customer = (await query('SELECT name FROM businesses WHERE phone = $1', [phone])).rows[0];
    if (customer) throw new HttpError(409, `${customer.name} already uses DukaSmart`);
    const dup = (await query(`SELECT 1 FROM leads WHERE phone = $1 AND status NOT IN ('converted', 'lost')`, [phone])).rows[0];
    if (dup) throw new HttpError(409, 'This shop is already being followed up as a lead');
  }
  const interest = ['hot', 'warm', 'cold'].includes(b.interest) ? b.interest : 'warm';
  const followUp = /^\d{4}-\d{2}-\d{2}$/.test(String(b.nextFollowUp || '')) ? b.nextFollowUp : null;
  const { rows } = await query(
    `INSERT INTO leads (business_name, contact_name, phone, business_type, location, interest, objection, source, agent_id, next_follow_up, created_by)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING id`,
    [name.slice(0, 120), String(b.contactName || '').trim().slice(0, 80) || null, phone, String(b.businessType || '').trim().slice(0, 40) || null,
      String(b.location || '').trim().slice(0, 120) || null, interest, String(b.objection || '').trim().slice(0, 300) || null,
      'Agent portal', req.agent.id, followUp, `agent:${req.agent.code}`]
  );
  res.status(201).json({ id: rows[0].id });
});

// The agent updates a lead after a follow-up visit. Body: { status?, nextFollowUp?, note? }
router.patch('/leads/:id', requireAgent, async (req, res) => {
  const lead = (await query('SELECT id FROM leads WHERE id = $1 AND agent_id = $2', [req.params.id, req.agent.id])).rows[0];
  if (!lead) throw new HttpError(404, 'Lead not found');
  const b = req.body || {};
  const status = ['contacted', 'interested', 'follow_up', 'lost'].includes(b.status) ? b.status : null;
  const followUp = /^\d{4}-\d{2}-\d{2}$/.test(String(b.nextFollowUp || '')) ? b.nextFollowUp : null;
  await query(
    `UPDATE leads SET status = COALESCE($2, status), next_follow_up = COALESCE($3::date, next_follow_up), updated_at = now() WHERE id = $1`,
    [lead.id, status, followUp]
  );
  if (b.note && String(b.note).trim()) {
    await query('INSERT INTO lead_notes (lead_id, note, author) VALUES ($1, $2, $3)', [lead.id, String(b.note).trim().slice(0, 1000), `agent:${req.agent.code}`]);
  }
  res.json({ ok: true });
});

module.exports = router;
