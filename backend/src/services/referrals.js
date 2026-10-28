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

// The bonuses a plan pays out: its own amounts where set, otherwise the default bonus rules
function bonusesFor(plan, settings) {
  const pick = (own, fallback) => (own === null || own === undefined ? Number(fallback) || 0 : Number(own));
  return {
    referrerDays: pick(plan && plan.referrer_bonus_days, settings.referrer_bonus_days),
    agentFirst: pick(plan && plan.agent_conversion_cash, settings.agent_conversion_cash),
    agentRenewal: pick(plan && plan.agent_recurring_cash, settings.agent_recurring_cash),
  };
}

// Bonuses for every plan on sale, for showing to referrers and agents
async function bonusesByPlan(db) {
  const settings = await getSettings(db);
  const plans = (await db.query('SELECT * FROM plans WHERE is_active ORDER BY sort_order, price_kes')).rows;
  return plans.map((p) => ({ code: p.code, name: p.name, price: p.price_kes, ...bonusesFor(p, settings) }));
}

// "30" when every plan gives the same, "15 to 30" when they differ
function rangeText(values) {
  const v = values.filter((n) => n > 0);
  if (!v.length) return '0';
  const lo = Math.min(...v), hi = Math.max(...v);
  return lo === hi ? String(lo) : `${lo} to ${hi}`;
}

// Called inside the payment transaction every time a payment succeeds.
// The bonus follows the plan the referred shop paid for.
async function onPaymentSuccess(db, payment) {
  const ref = (await db.query('SELECT * FROM referrals WHERE referee_id = $1', [payment.business_id])).rows[0];
  if (!ref) return;
  const plan = (await db.query('SELECT * FROM plans WHERE code = $1', [payment.plan_code])).rows[0];
  const bonus = bonusesFor(plan, await getSettings(db));

  const first = await db.query(
    `UPDATE referrals SET status = 'converted', converted_at = now()
      WHERE id = $1 AND status = 'signed_up' RETURNING id`,
    [ref.id]
  );
  const isFirst = Boolean(first.rows[0]);

  if (ref.referrer_type === 'business' && ref.referrer_business && isFirst && bonus.referrerDays > 0) {
    const r = await db.query(
      `INSERT INTO referral_rewards (referral_id, payment_id, kind, amount, reason, status)
       VALUES ($1, $2, 'days', $3, 'conversion', 'applied') ON CONFLICT DO NOTHING RETURNING id`,
      [ref.id, payment.id, bonus.referrerDays]
    );
    if (r.rows[0]) await addBonusDays(db, ref.referrer_business, bonus.referrerDays);
  }

  if (ref.referrer_type === 'agent' && ref.referrer_agent) {
    const cash = isFirst ? bonus.agentFirst : bonus.agentRenewal;
    if (cash > 0) {
      await db.query(
        `INSERT INTO referral_rewards (referral_id, payment_id, kind, amount, reason)
         VALUES ($1, $2, 'cash', $3, $4) ON CONFLICT DO NOTHING`,
        [ref.id, payment.id, cash, isFirst ? 'conversion' : 'renewal']
      );
    }
  }
}

module.exports = { uniqueCode, normalizeCode, resolveCode, recordReferral, onPaymentSuccess, randomCode, bonusesFor, bonusesByPlan, rangeText };
