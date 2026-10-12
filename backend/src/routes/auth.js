const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const { query, transaction } = require('../db');
const { HttpError, normalizePhone, publicBusiness } = require('../utils');
const { requireUser } = require('../middleware/auth');
const { uniqueCode, resolveCode, recordReferral } = require('../services/referrals');
const { getSettings } = require('../services/settings');
const { getLimits } = require('../services/limits');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30 });

function signToken(business, employee) {
  return jwt.sign({ bid: business.id, ...(employee ? { eid: employee.id } : {}) }, process.env.JWT_SECRET, { expiresIn: '90d' });
}

function publicEmployee(e) {
  return e ? { id: e.id, name: e.name, phone: e.phone, role: e.role, branchId: e.branch_id } : null;
}

async function sessionPayload(business, employee) {
  return {
    business: publicBusiness(business),
    employee: publicEmployee(employee),
    role: employee ? employee.role : 'owner',
    limits: await getLimits({ query }, business),
  };
}

// Lets the app show "Invited by Baraka Mini Mart" before the owner finishes signing up
router.get('/referral/:code', limiter, async (req, res) => {
  const ref = await resolveCode({ query }, req.params.code);
  if (!ref) throw new HttpError(404, 'That invite code was not found');
  const name = ref.type === 'business'
    ? (await query('SELECT name FROM businesses WHERE id = $1', [ref.id])).rows[0].name
    : (await query('SELECT name FROM agents WHERE id = $1', [ref.id])).rows[0].name;
  const settings = await getSettings();
  res.json({ code: ref.code, referrerName: name, bonusTrialDays: settings.referee_bonus_trial_days });
});

router.post('/register', limiter, async (req, res) => {
  const { businessName, ownerName, phone, pin, businessType, location, referralCode } = req.body || {};
  const normalized = normalizePhone(phone);
  if (!businessName || !String(businessName).trim()) throw new HttpError(400, 'Business name is required');
  if (!normalized) throw new HttpError(400, 'Enter a valid Safaricom number, e.g. 0712345678');
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw new HttpError(400, 'PIN must be 4 to 6 digits');

  const existing = await query('SELECT 1 FROM businesses WHERE phone = $1 UNION ALL SELECT 1 FROM employees WHERE phone = $1', [normalized]);
  if (existing.rows[0]) throw new HttpError(409, 'This phone number is already registered. Sign in instead.');

  let ref = null;
  if (referralCode) {
    ref = await resolveCode({ query }, referralCode);
    if (!ref) throw new HttpError(400, 'That invite code was not found. Check it or leave it empty.');
    if (ref.type === 'agent') {
      const agent = (await query('SELECT phone FROM agents WHERE id = $1', [ref.id])).rows[0];
      if (agent && agent.phone === normalized) ref = null; // agents cannot earn from signing themselves up
    }
  }

  const settings = await getSettings();
  const trialDays = Number(process.env.TRIAL_DAYS || 7) + (ref ? settings.referee_bonus_trial_days : 0);
  const pinHash = await bcrypt.hash(String(pin), 10);

  const business = await transaction(async (client) => {
    const code = await uniqueCode(client);
    const b = (await client.query(
      `INSERT INTO businesses (name, owner_name, phone, pin_hash, business_type, location, trial_ends_at, referral_code)
       VALUES ($1, $2, $3, $4, $5, $6, now() + make_interval(days => $7), $8)
       RETURNING *`,
      [String(businessName).trim(), ownerName || null, normalized, pinHash, businessType || 'duka', location || null, trialDays, code]
    )).rows[0];

    const now = Date.now();
    await client.query(
      `INSERT INTO branches (id, business_id, name, location, created_at, updated_at)
       VALUES (gen_random_uuid(), $1, 'Main branch', $2, $3, $3)`,
      [b.id, location || null, now]
    );
    if (ref) await recordReferral(client, b.id, ref);

    // A lead you were following up just signed up
    await client.query(
      `UPDATE leads SET status = 'converted', converted_business_id = $2, updated_at = now()
        WHERE phone = $1 AND status <> 'converted'`,
      [normalized, b.id]
    );
    return b;
  });

  res.status(201).json({ token: signToken(business), ...(await sessionPayload(business, null)) });
});

// Owners and employees both sign in with their own phone number and PIN
router.post('/login', limiter, async (req, res) => {
  const { phone, pin } = req.body || {};
  const normalized = normalizePhone(phone);
  const wrong = new HttpError(401, 'Wrong phone number or PIN');
  if (!normalized) throw wrong;

  const owner = (await query('SELECT * FROM businesses WHERE phone = $1', [normalized])).rows[0];
  if (owner) {
    if (!(await bcrypt.compare(String(pin || ''), owner.pin_hash))) throw wrong;
    return res.json({ token: signToken(owner), ...(await sessionPayload(owner, null)) });
  }

  const employee = (await query('SELECT * FROM employees WHERE phone = $1', [normalized])).rows[0];
  if (!employee || !(await bcrypt.compare(String(pin || ''), employee.pin_hash))) throw wrong;
  if (!employee.is_active) throw new HttpError(403, 'Your staff account has been turned off. Talk to the owner.');
  const business = (await query('SELECT * FROM businesses WHERE id = $1', [employee.business_id])).rows[0];
  res.json({ token: signToken(business, employee), ...(await sessionPayload(business, employee)) });
});

router.get('/me', requireUser, async (req, res) => {
  res.json(await sessionPayload(req.business, req.employee));
});

router.patch('/me', requireUser, async (req, res) => {
  if (req.role !== 'owner') throw new HttpError(403, 'Only the owner can change business details');
  const { businessName, ownerName, location } = req.body || {};
  const { rows } = await query(
    `UPDATE businesses SET name = COALESCE($2, name), owner_name = COALESCE($3, owner_name),
            location = COALESCE($4, location)
      WHERE id = $1 RETURNING *`,
    [req.business.id, businessName || null, ownerName || null, location || null]
  );
  res.json(await sessionPayload(rows[0], null));
});

module.exports = router;
