const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query, transaction } = require('../db');
const { HttpError, publicBusiness } = require('../utils');
const { requireAdmin } = require('../middleware/auth');
const { extendSubscription, addSmsCredits } = require('../services/subscription');
const till = require('../services/till');
const { onPaymentSuccess } = require('../services/referrals');
const { temporaryPin, hashPin, deleteBusiness } = require('../services/accounts');

const router = express.Router();

router.post('/login', rateLimit({ windowMs: 15 * 60 * 1000, limit: 20 }), async (req, res) => {
  const { email, password } = req.body || {};
  const cleanEmail = String(email || '').trim().toLowerCase();
  const admin = (await query('SELECT * FROM admins WHERE email = $1', [cleanEmail])).rows[0];
  if (!admin || !(await bcrypt.compare(String(password || ''), admin.password_hash))) {
    // Only in the server window, to help you see which part was wrong
    console.warn(`Admin login failed for ${cleanEmail}: ${admin ? 'wrong password' : 'no admin with this email in this database'}`);
    throw new HttpError(401, 'Wrong email or password');
  }
  const token = jwt.sign({ aid: admin.id, role: 'admin', email: admin.email }, process.env.ADMIN_JWT_SECRET, { expiresIn: '12h' });
  res.json({ token, admin: { id: admin.id, email: admin.email, name: admin.name } });
});

router.use(requireAdmin);
router.use('/leads', require('./adminLeads'));
router.use('/', require('./adminReferrals'));

const STATE_SQL = {
  trial: `status = 'active' AND (subscription_ends_at IS NULL OR subscription_ends_at <= now()) AND trial_ends_at > now()`,
  active: `status = 'active' AND subscription_ends_at > now()`,
  expired: `status = 'active' AND COALESCE(subscription_ends_at, 'epoch') <= now() AND trial_ends_at <= now()`,
  suspended: `status = 'suspended'`,
};

router.get('/stats', async (req, res) => {
  const counts = {};
  for (const [state, where] of Object.entries(STATE_SQL)) {
    counts[state] = Number((await query(`SELECT count(*) FROM businesses WHERE ${where}`)).rows[0].count);
  }
  const total = Number((await query('SELECT count(*) FROM businesses')).rows[0].count);
  const revenue = (await query(`
    SELECT COALESCE(sum(amount) FILTER (WHERE created_at >= date_trunc('month', now())), 0) AS month,
           COALESCE(sum(amount), 0) AS all_time
      FROM payments WHERE status = 'success'`)).rows[0];
  const signups = (await query(`
    SELECT to_char(d, 'YYYY-MM-DD') AS day, count(b.id)::int AS count
      FROM generate_series(current_date - 13, current_date, interval '1 day') d
      LEFT JOIN businesses b ON b.created_at::date = d::date
     GROUP BY d ORDER BY d`)).rows;
  const activeToday = Number((await query(`SELECT count(*) FROM businesses WHERE last_sync_at > now() - interval '1 day'`)).rows[0].count);

  const leads = (await query(`
    SELECT count(*) FILTER (WHERE status NOT IN ('converted', 'lost'))::int AS open,
           count(*) FILTER (WHERE status NOT IN ('converted', 'lost') AND next_follow_up <= current_date)::int AS due
      FROM leads`)).rows[0];
  const refs = (await query(`
    SELECT (SELECT count(*)::int FROM referrals WHERE created_at >= date_trunc('month', now())) AS month_signups,
           (SELECT count(*)::int FROM referrals WHERE status = 'converted') AS converted,
           (SELECT COALESCE(sum(amount), 0)::int FROM referral_rewards WHERE kind = 'cash' AND status = 'pending') AS pending_cash`)).rows[0];
  const sms = (await query(`
    SELECT COALESCE(sum(segments) FILTER (WHERE status = 'sent'), 0)::int AS sent,
           COALESCE(sum(NULLIF(regexp_replace(cost, '[^0-9.]', '', 'g'), '')::numeric) FILTER (WHERE status = 'sent'), 0)::float AS cost
      FROM sms_messages WHERE created_at >= date_trunc('month', now())`)).rows[0];
  res.json({
    total, ...counts, activeToday,
    smsSentMonth: sms.sent, smsCostMonth: Math.round(sms.cost * 100) / 100,
    openLeads: leads.open, leadsDue: leads.due,
    referralSignupsMonth: refs.month_signups, referralConversions: refs.converted, pendingPayouts: refs.pending_cash,
    revenueMonth: Number(revenue.month), revenueAllTime: Number(revenue.all_time),
    signups,
  });
});

router.get('/businesses', async (req, res) => {
  const { search = '', state = '', page = 1 } = req.query;
  const pageSize = 25;
  const where = [];
  const params = [];
  if (search) {
    params.push(`%${search}%`);
    where.push(`(name ILIKE $${params.length} OR phone ILIKE $${params.length} OR owner_name ILIKE $${params.length})`);
  }
  if (STATE_SQL[state]) where.push(STATE_SQL[state]);
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

  const total = Number((await query(`SELECT count(*) FROM businesses ${whereSql}`, params)).rows[0].count);
  params.push(pageSize, (Math.max(Number(page), 1) - 1) * pageSize);
  const { rows } = await query(
    `SELECT * FROM businesses ${whereSql} ORDER BY created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ businesses: rows.map((b) => ({ ...publicBusiness(b), lastSyncAt: b.last_sync_at })), total, pageSize });
});

router.get('/businesses/:id', async (req, res) => {
  const b = (await query('SELECT * FROM businesses WHERE id = $1', [req.params.id])).rows[0];
  if (!b) throw new HttpError(404, 'Business not found');
  const payments = (await query('SELECT * FROM payments WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50', [b.id])).rows;
  const usage = (await query(`
    SELECT (SELECT count(*) FROM sales WHERE business_id = $1 AND NOT deleted)::int AS sales,
           (SELECT count(*) FROM expenses WHERE business_id = $1 AND NOT deleted)::int AS expenses,
           (SELECT count(*) FROM customers WHERE business_id = $1 AND NOT deleted)::int AS customers,
           (SELECT count(*) FROM debt_entries WHERE business_id = $1 AND NOT deleted)::int AS debt_entries,
           (SELECT count(*) FROM products WHERE business_id = $1 AND NOT deleted)::int AS products`, [b.id])).rows[0];
  const branches = (await query('SELECT id, name, location FROM branches WHERE business_id = $1 AND NOT deleted ORDER BY created_at', [b.id])).rows;
  const employees = (await query('SELECT id, name, phone, role, branch_id, is_active, last_seen_at FROM employees WHERE business_id = $1 ORDER BY name', [b.id])).rows;
  const referredBy = (await query(`
    SELECT r.status, r.code_used, r.referrer_type, COALESCE(rb.name, a.name) AS referrer_name
      FROM referrals r LEFT JOIN businesses rb ON rb.id = r.referrer_business LEFT JOIN agents a ON a.id = r.referrer_agent
     WHERE r.referee_id = $1`, [b.id])).rows[0] || null;
  const referred = (await query(`SELECT count(*)::int AS n, count(*) FILTER (WHERE status = 'converted')::int AS converted FROM referrals WHERE referrer_business = $1`, [b.id])).rows[0];
  const sms = (await query(`
    SELECT count(*) FILTER (WHERE status <> 'failed')::int AS sent,
           COALESCE(sum(segments) FILTER (WHERE status <> 'failed'), 0)::int AS used,
           max(created_at) AS last_sent
      FROM sms_messages WHERE business_id = $1`, [b.id])).rows[0];
  res.json({ business: { ...publicBusiness(b), lastSyncAt: b.last_sync_at }, payments, usage, branches, employees, referredBy, referred, sms });
});

// Body: { status?: 'active'|'suspended', extendTrialDays?: number }
router.patch('/businesses/:id', async (req, res) => {
  const { status, extendTrialDays } = req.body || {};
  if (status && !['active', 'suspended'].includes(status)) throw new HttpError(400, 'Invalid status');
  const { rows } = await query(
    `UPDATE businesses
        SET status = COALESCE($2, status),
            trial_ends_at = CASE WHEN $3::int > 0 THEN GREATEST(now(), trial_ends_at) + make_interval(days => $3::int) ELSE trial_ends_at END
      WHERE id = $1 RETURNING *`,
    [req.params.id, status || null, Number(extendTrialDays) || 0]
  );
  if (!rows[0]) throw new HttpError(404, 'Business not found');
  res.json({ business: publicBusiness(rows[0]) });
});

// Record a cash or manual payment and activate the plan. Body: { planCode, months?, note? }
// Owner forgot their PIN: sets a new temporary PIN and returns it so you can tell them.
// Body (optional): { pin } to choose the PIN yourself.
router.post('/businesses/:id/reset-pin', async (req, res) => {
  const chosen = req.body && req.body.pin ? String(req.body.pin) : null;
  if (chosen && !/^\d{4,6}$/.test(chosen)) throw new HttpError(400, 'PIN must be 4 to 6 digits');
  const pin = chosen || temporaryPin();
  const { rows } = await query('UPDATE businesses SET pin_hash = $2 WHERE id = $1 RETURNING name, phone', [req.params.id, await hashPin(pin)]);
  if (!rows[0]) throw new HttpError(404, 'Business not found');
  console.log(`Owner PIN reset for ${rows[0].name} by ${req.admin.email}`);
  res.json({ pin, phone: rows[0].phone });
});

router.post('/employees/:id/reset-pin', async (req, res) => {
  const chosen = req.body && req.body.pin ? String(req.body.pin) : null;
  if (chosen && !/^\d{4,6}$/.test(chosen)) throw new HttpError(400, 'PIN must be 4 to 6 digits');
  const pin = chosen || temporaryPin();
  const { rows } = await query('UPDATE employees SET pin_hash = $2 WHERE id = $1 RETURNING name, phone', [req.params.id, await hashPin(pin)]);
  if (!rows[0]) throw new HttpError(404, 'Staff member not found');
  console.log(`Staff PIN reset for ${rows[0].name} by ${req.admin.email}`);
  res.json({ pin, phone: rows[0].phone });
});

// Permanent deletion, e.g. when a shop asks for its data to be removed.
// Body: { confirmName } must match the business name exactly.
router.delete('/businesses/:id', async (req, res) => {
  const b = (await query('SELECT name FROM businesses WHERE id = $1', [req.params.id])).rows[0];
  if (!b) throw new HttpError(404, 'Business not found');
  if (!req.body || String(req.body.confirmName || '').trim() !== b.name) {
    throw new HttpError(400, 'Type the business name exactly to confirm deletion');
  }
  const deleted = await transaction((client) => deleteBusiness(client, req.params.id));
  console.log(`Business deleted: ${deleted.name} (${deleted.phone}) by ${req.admin.email}`);
  res.json({ ok: true });
});

// ---- M-Pesa till connection (payments recorded as sales automatically) ----

router.get('/businesses/:id/till', async (req, res) => {
  const conn = (await query('SELECT * FROM till_connections WHERE business_id = $1', [req.params.id])).rows[0];
  const payments = (await query(
    `SELECT trans_id, amount::float AS amount, payer_name, paid_at FROM till_payments
      WHERE business_id = $1 ORDER BY paid_at DESC LIMIT 10`, [req.params.id])).rows;
  res.json({
    connection: till.publicConnection(conn),
    payments,
    callbackBase: conn ? till.callbackUrls(conn).confirmation : null,
    publicBaseUrl: process.env.PUBLIC_BASE_URL || null,
  });
});

// Body: { environment, shortcode, tillNumber, branchId, consumerKey?, consumerSecret? }
// Saves the till and registers its payment link with Safaricom. Leave the key and secret empty to keep the saved ones.
router.put('/businesses/:id/till', async (req, res) => {
  const b = (await query('SELECT id FROM businesses WHERE id = $1', [req.params.id])).rows[0];
  if (!b) throw new HttpError(404, 'Business not found');
  const { environment = 'production', kind = 'till', shortcode, tillNumber, branchId, consumerKey, consumerSecret, passkey, removePasskey } = req.body || {};
  if (!['till', 'paybill'].includes(kind)) throw new HttpError(400, 'Choose till or paybill');
  if (!['sandbox', 'production'].includes(environment)) throw new HttpError(400, 'Choose sandbox or production');
  if (!/^\d{5,8}$/.test(String(shortcode || '').trim())) throw new HttpError(400, 'Enter the store number (or paybill) as digits');
  if (!/^https:\/\//.test(process.env.PUBLIC_BASE_URL || '') && environment === 'production') {
    throw new HttpError(400, 'PUBLIC_BASE_URL on the server must be your https address before a live till can be connected');
  }
  if (branchId) {
    const ok = (await query('SELECT 1 FROM branches WHERE id = $1 AND business_id = $2 AND NOT deleted', [branchId, b.id])).rows[0];
    if (!ok) throw new HttpError(400, 'That branch does not belong to this business');
  }

  const existing = (await query('SELECT * FROM till_connections WHERE business_id = $1', [b.id])).rows[0];
  if (!existing && (!consumerKey || !consumerSecret)) throw new HttpError(400, 'Enter the consumer key and secret from the till\'s Daraja app');
  const k = consumerKey ? till.encrypt(String(consumerKey).trim()) : existing.consumer_key;
  const s = consumerSecret ? till.encrypt(String(consumerSecret).trim()) : existing.consumer_secret;
  const p = passkey ? till.encrypt(String(passkey).trim()) : (removePasskey ? null : (existing ? existing.passkey : null));

  let conn = (await query(
    `INSERT INTO till_connections (business_id, branch_id, environment, shortcode, till_number, consumer_key, consumer_secret, callback_token, status, kind, passkey)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', $9, $10)
     ON CONFLICT (business_id) DO UPDATE SET branch_id = $2, environment = $3, shortcode = $4, till_number = $5,
            consumer_key = $6, consumer_secret = $7, status = 'pending', last_error = NULL, kind = $9, passkey = $10, updated_at = now()
     RETURNING *`,
    [b.id, branchId || null, environment, String(shortcode).trim(), tillNumber ? String(tillNumber).trim() : null, k, s,
      require('crypto').randomBytes(24).toString('hex'), kind, p]
  )).rows[0];

  try {
    await till.registerUrls(conn);
    conn = (await query(`UPDATE till_connections SET status = 'active', registered_at = now(), last_error = NULL WHERE id = $1 RETURNING *`, [conn.id])).rows[0];
    console.log(`Till ${conn.shortcode} connected for business ${b.id} by ${req.admin.email}`);
  } catch (e) {
    // Safaricom refuses to register a shortcode twice. Payments may still come if the earlier registration pointed here.
    const already = /duplicate|already/i.test(e.message);
    const note = already
      ? 'Safaricom says this till was already registered. If no payments arrive after a test payment, ask Safaricom (apisupport@safaricom.co.ke) to delete the old URLs, then save again.'
      : e.message;
    conn = (await query(`UPDATE till_connections SET status = $3, last_error = $2 WHERE id = $1 RETURNING *`,
      [conn.id, note, already ? 'pending' : 'failed'])).rows[0];
  }
  res.json({ connection: till.publicConnection(conn) });
});

// Keeps the settings but ignores payments until it is connected again
router.post('/businesses/:id/till/disable', async (req, res) => {
  const { rows } = await query(`UPDATE till_connections SET status = 'disabled', updated_at = now() WHERE business_id = $1 RETURNING *`, [req.params.id]);
  if (!rows[0]) throw new HttpError(404, 'No till connected');
  res.json({ connection: till.publicConnection(rows[0]) });
});

// Sandbox only. Body: { amount }
router.post('/businesses/:id/till/simulate', async (req, res) => {
  const conn = (await query('SELECT * FROM till_connections WHERE business_id = $1', [req.params.id])).rows[0];
  if (!conn) throw new HttpError(404, 'No till connected');
  try {
    res.json({ result: await till.simulate(conn, (req.body || {}).amount) });
  } catch (e) {
    throw new HttpError(400, e.message);
  }
});

// Give (or take back, with a negative number) SMS reminders. Body: { amount }
router.post('/businesses/:id/sms-credits', async (req, res) => {
  const amount = Math.round(Number((req.body || {}).amount));
  if (!amount || Math.abs(amount) > 10000) throw new HttpError(400, 'Enter a number of SMS, for example 20');
  const { rows } = await query(
    'UPDATE businesses SET sms_credits = GREATEST(0, sms_credits + $2) WHERE id = $1 RETURNING *',
    [req.params.id, amount]
  );
  if (!rows[0]) throw new HttpError(404, 'Business not found');
  console.log(`SMS credits ${amount > 0 ? '+' : ''}${amount} for ${rows[0].name} by ${req.admin.email}`);
  res.json({ business: publicBusiness(rows[0]) });
});

router.post('/businesses/:id/grant', async (req, res) => {
  const { planCode, months = 1, note } = req.body || {};
  const plan = (await query('SELECT * FROM plans WHERE code = $1', [planCode])).rows[0];
  if (!plan) throw new HttpError(400, 'Invalid plan');
  const b = (await query('SELECT * FROM businesses WHERE id = $1', [req.params.id])).rows[0];
  if (!b) throw new HttpError(404, 'Business not found');
  const m = Math.max(1, Math.min(Number(months) || 1, 24));

  await transaction(async (client) => {
    const payment = (await client.query(
      `INSERT INTO payments (business_id, plan_code, amount, phone, source, status, result_desc)
       VALUES ($1, $2, $3, $4, 'manual', 'success', $5) RETURNING *`,
      [b.id, plan.code, plan.price_kes * m, b.phone, note || `Granted by ${req.admin.email}`]
    )).rows[0];
    await extendSubscription(client, b.id, plan.code, plan.duration_days * m);
    await addSmsCredits(client, b.id, plan.sms_credits * m);
    await onPaymentSuccess(client, payment);
  });
  const updated = (await query('SELECT * FROM businesses WHERE id = $1', [b.id])).rows[0];
  res.json({ business: publicBusiness(updated) });
});

router.get('/payments', async (req, res) => {
  const { status = '', page = 1 } = req.query;
  const pageSize = 50;
  const params = [];
  let where = '';
  if (status) { params.push(status); where = `WHERE p.status = $1`; }
  params.push(pageSize, (Math.max(Number(page), 1) - 1) * pageSize);
  const { rows } = await query(
    `SELECT p.*, b.name AS business_name FROM payments p JOIN businesses b ON b.id = p.business_id
      ${where} ORDER BY p.created_at DESC LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );
  res.json({ payments: rows, pageSize });
});

router.get('/plans', async (req, res) => {
  res.json({ plans: (await query('SELECT * FROM plans ORDER BY sort_order, price_kes')).rows });
});

router.put('/plans/:code', async (req, res) => {
  const { name, price_kes, duration_days, features, is_active, sort_order, max_branches, max_employees, sms_credits } = req.body || {};
  if (!name || !(Number(price_kes) > 0) || !(Number(duration_days) > 0)) throw new HttpError(400, 'Name, price and duration are required');
  const { rows } = await query(
    `INSERT INTO plans (code, name, price_kes, duration_days, features, is_active, sort_order, max_branches, max_employees, sms_credits)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (code) DO UPDATE SET name = $2, price_kes = $3, duration_days = $4, features = $5, is_active = $6, sort_order = $7,
                                      max_branches = $8, max_employees = $9, sms_credits = $10
     RETURNING *`,
    [req.params.code, name, Number(price_kes), Number(duration_days), JSON.stringify(features || []), is_active !== false, Number(sort_order) || 0,
      Math.max(1, Number(max_branches) || 1), Math.max(0, Number(max_employees) || 0), Math.max(0, Math.round(Number(sms_credits) || 0))]
  );
  res.json({ plan: rows[0] });
});

module.exports = router;
