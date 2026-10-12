const { query } = require('../db');

const DEFAULTS = {
  referrer_bonus_days: 30,
  referee_bonus_trial_days: 7,
  agent_conversion_cash: 100,
  agent_recurring_cash: 0,
};

async function getSettings(db = { query }) {
  const { rows } = await db.query('SELECT key, value FROM settings');
  const out = { ...DEFAULTS };
  rows.forEach((r) => { out[r.key] = r.value; });
  return out;
}

async function saveSettings(values) {
  for (const key of Object.keys(DEFAULTS)) {
    if (values[key] === undefined) continue;
    const n = Math.max(0, Math.round(Number(values[key]) || 0));
    await query(
      'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
      [key, JSON.stringify(n)]
    );
  }
  return getSettings();
}

module.exports = { getSettings, saveSettings, DEFAULTS };
