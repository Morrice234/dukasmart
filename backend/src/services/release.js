// The Android app file people download before DukaSmart is on Play Store.
// The link is set in the admin panel, so a new build only needs a new link, not a new deploy.
const { query } = require('../db');

const KEY = 'app_release';

async function getRelease() {
  const row = (await query('SELECT value FROM settings WHERE key = $1', [KEY])).rows[0];
  return row ? row.value : null;
}

async function setRelease({ url, version, notes }) {
  const value = {
    url: String(url || '').trim(),
    version: String(version || '').trim(),
    notes: String(notes || '').trim().slice(0, 500),
    updatedAt: new Date().toISOString(),
  };
  await query(
    'INSERT INTO settings (key, value) VALUES ($1, $2) ON CONFLICT (key) DO UPDATE SET value = $2',
    [KEY, JSON.stringify(value)]
  );
  return value;
}

// Where invite links point: the public download page on the Netlify site
function inviteLink(code) {
  const base = String(process.env.INVITE_BASE_URL || 'https://dukasmart-admin.netlify.app').replace(/\/+$/, '');
  return code ? `${base}/i/${encodeURIComponent(code)}` : `${base}/download`;
}

module.exports = { getRelease, setRelease, inviteLink };
