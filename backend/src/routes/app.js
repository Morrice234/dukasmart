// Public: latest Android app version and the download itself (counted per invite code)
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query } = require('../db');
const { getRelease } = require('../services/release');
const { getSettings } = require('../services/settings');

const router = express.Router();

function downloadUrl(code) {
  const base = String(process.env.PUBLIC_BASE_URL || '').replace(/\/+$/, '');
  return `${base}/api/app/download${code ? `?code=${encodeURIComponent(code)}` : ''}`;
}

router.get('/latest', async (req, res) => {
  const r = await getRelease();
  const settings = await getSettings();
  res.set('Cache-Control', 'public, max-age=60');
  res.json({
    available: Boolean(r && r.url),
    version: r ? r.version : null,
    notes: r ? r.notes : null,
    updatedAt: r ? r.updatedAt : null,
    downloadUrl: downloadUrl(req.query.code ? String(req.query.code).slice(0, 20) : null),
    bonusTrialDays: settings.referee_bonus_trial_days,
    trialDays: Number(process.env.TRIAL_DAYS || 7),
  });
});

// Counts the download, then sends the phone to the APK file
router.get('/download', rateLimit({ windowMs: 60 * 1000, limit: 30 }), async (req, res) => {
  const r = await getRelease();
  if (!r || !r.url) return res.status(404).send('The app is not available for download yet. Please try again later.');
  const code = req.query.code ? String(req.query.code).toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 20) : null;
  query('INSERT INTO app_downloads (code, version, user_agent) VALUES ($1, $2, $3)',
    [code || null, r.version || null, String(req.get('user-agent') || '').slice(0, 200)]).catch(() => {});
  res.redirect(302, r.url);
});

module.exports = router;
