const { subscriptionInfo } = require('../utils');

// What a business may use right now. Trials get the biggest plan so owners can try everything.
async function getLimits(db, business) {
  const sub = subscriptionInfo(business);
  const { rows } = await db.query('SELECT code, max_branches, max_employees FROM plans WHERE is_active OR code = $1', [business.plan_code]);
  if (!rows.length) return { maxBranches: 1, maxEmployees: 0 };

  let plan;
  if (sub.state === 'trial') {
    plan = rows.reduce((a, b) => (b.max_branches + b.max_employees > a.max_branches + a.max_employees ? b : a));
  } else {
    plan = rows.find((p) => p.code === business.plan_code)
      || rows.reduce((a, b) => (b.max_branches + b.max_employees < a.max_branches + a.max_employees ? b : a));
  }
  return { maxBranches: plan.max_branches, maxEmployees: plan.max_employees, basedOn: plan.code };
}

module.exports = { getLimits };
