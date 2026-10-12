const crypto = require('crypto');
const { getSettings } = require('./settings');

// Letters and digits that are hard to confuse when read out loud (no 0/O, 1/I)
const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

function randomCode(len = 6) {
  const bytes = crypto.randomBytes(len);
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join('');
}

async function uniqueCode(db) {
  for (let i = 0; i < 10; i++) {
    const code = randomCode();
    const taken = await db.query(
      'SELECT 1 FROM businesses WHERE referral_code = $1 UNION SELECT 1 FROM agents WHERE code = $1',
      [code]
    );
    if (!taken.rows.length) return code;
  }
  throw new Error('Could not generate a referral code');
}

function normalizeCode(code) {
  return String(code || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
}

async function resolveCode(db, rawCode) {
  const code = normalizeCode(rawCode);
  if (!code) return null;
  const b = await db.query('SELECT id FROM businesses WHERE referral_code = $1', [code]);
  if (b.rows[0]) return { type: 'business', id: b.rows[0].id, code };
  const a = await db.query('SELECT id FROM agents WHERE code = $1 AND is_active', [code]);
  if (a.rows[0]) return { type: 'agent', id: a.rows[0].id, code };
  return null;
}

async function recordReferral(db, refereeId, ref) {
  await db.query(
    `INSERT INTO referrals (referee_id, referrer_type, referrer_business, referrer_agent, code_used)
     VALUES ($1, $2, $3, $4, $5) ON CONFLICT (referee_id) DO NOTHING`,
    [refereeId, ref.type, ref.type === 'business' ? ref.id : null, ref.type === 'agent' ? ref.id : null, ref.code]
  );
}

// Add free days on top of whatever the referrer currently has (trial or paid)
async function addBonusDays(db, businessId, days) {
  await db.query(
    `UPDATE businesses
        SET subscription_ends_at = GREATEST(now(), COALESCE(subscription_ends_at, now()), trial_ends_at) + make_interval(days => $2),
            plan_code = COALESCE(plan_code, 'basic')
      WHERE id = $1`,
    [businessId, days]
  );
}

// Called inside the payment transaction every time a payment succeeds
async function onPaymentSuccess(db, payment) {
  const ref = (await db.query('SELECT * FROM referrals WHERE referee_id = $1', [payment.business_id])).rows[0];
  if (!ref) return;
  const settings = await getSettings(db);

  const first = await db.query(
    `UPDATE referrals SET status = 'converted', converted_at = now()
      WHERE id = $1 AND status = 'signed_up' RETURNING id`,
    [ref.id]
  );
  const isFirst = Boolean(first.rows[0]);

  if (ref.referrer_type === 'business' && ref.referrer_business && isFirst && settings.referrer_bonus_days > 0) {
    const r = await db.query(
      `INSERT INTO referral_rewards (referral_id, payment_id, kind, amount, reason, status)
       VALUES ($1, $2, 'days', $3, 'conversion', 'applied') ON CONFLICT DO NOTHING RETURNING id`,
      [ref.id, payment.id, settings.referrer_bonus_days]
    );
    if (r.rows[0]) await addBonusDays(db, ref.referrer_business, settings.referrer_bonus_days);
  }

  if (ref.referrer_type === 'agent' && ref.referrer_agent) {
    const cash = isFirst ? settings.agent_conversion_cash : settings.agent_recurring_cash;
    if (cash > 0) {
      await db.query(
        `INSERT INTO referral_rewards (referral_id, payment_id, kind, amount, reason)
         VALUES ($1, $2, 'cash', $3, $4) ON CONFLICT DO NOTHING`,
        [ref.id, payment.id, cash, isFirst ? 'conversion' : 'renewal']
      );
    }
  }
}

module.exports = { uniqueCode, normalizeCode, resolveCode, recordReferral, onPaymentSuccess, randomCode };
