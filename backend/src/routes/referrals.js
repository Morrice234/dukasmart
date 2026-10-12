const express = require('express');
const { query } = require('../db');
const { requireUser } = require('../middleware/auth');
const { getSettings } = require('../services/settings');

const router = express.Router();

// The owner's invite screen: their code, what they earn and who signed up with it
router.get('/', requireUser, async (req, res) => {
  const b = req.business;
  const settings = await getSettings();
  const { rows } = await query(
    `SELECT r.id, r.status, r.created_at, r.converted_at, rb.name AS business_name,
            COALESCE((SELECT sum(amount) FROM referral_rewards rw WHERE rw.referral_id = r.id AND rw.kind = 'days'), 0)::int AS days_earned
       FROM referrals r JOIN businesses rb ON rb.id = r.referee_id
      WHERE r.referrer_business = $1
      ORDER BY r.created_at DESC`,
    [b.id]
  );
  const totals = rows.reduce(
    (t, r) => ({ signedUp: t.signedUp + 1, converted: t.converted + (r.status === 'converted' ? 1 : 0), daysEarned: t.daysEarned + r.days_earned }),
    { signedUp: 0, converted: 0, daysEarned: 0 }
  );
  res.json({
    code: b.referral_code,
    rewardDays: settings.referrer_bonus_days,
    friendBonusDays: settings.referee_bonus_trial_days,
    shareMessage: `I use DukaSmart to track my sales, expenses and deni on my phone. Sign up with my code ${b.referral_code} and get ${settings.referee_bonus_trial_days} extra free days.`,
    totals,
    referrals: rows.map((r) => ({
      id: r.id, businessName: r.business_name, status: r.status,
      joinedAt: r.created_at, convertedAt: r.converted_at, daysEarned: r.days_earned,
    })),
  });
});

module.exports = router;
