const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, transaction } = require('../db');
const { HttpError, normalizePhone } = require('../utils');
const { requireUser, requireActiveSubscription } = require('../middleware/auth');
const { sendSms, segmentsFor, mode } = require('../services/sms');

const router = express.Router();
router.use(requireUser);

const MAX_PER_REQUEST = 100;
const MAX_SEGMENTS = 2; // a reminder longer than 2 SMS is almost always a mistake
const DEFAULT_TEMPLATE = 'Habari {name}, this is a friendly reminder from {shop} that your balance is KES {balance}. Asante!';

function canSend(req) {
  return req.role === 'owner' || req.role === 'manager';
}

function fill(template, { name, balance, shop }) {
  return String(template)
    .replace(/\{name\}/gi, name)
    .replace(/\{balance\}/gi, Number(balance).toLocaleString('en-KE', { maximumFractionDigits: 2 }))
    .replace(/\{shop\}/gi, shop)
    .trim();
}

// SMS left, the default message and the last messages sent
router.get('/', async (req, res) => {
  const recent = (await query(
    `SELECT m.id, m.phone, m.message, m.segments, m.status, m.created_at, c.name AS customer_name
       FROM sms_messages m LEFT JOIN customers c ON c.id = m.customer_id
      WHERE m.business_id = $1 ORDER BY m.created_at DESC LIMIT 30`,
    [req.business.id]
  )).rows;
  res.json({
    credits: req.business.sms_credits,
    canSend: canSend(req),
    template: DEFAULT_TEMPLATE,
    testMode: mode() === 'console',
    recent,
  });
});

// Body: { customerIds: [...], message: 'Hi {name}, you owe KES {balance} at {shop}' }
// Only customers who still owe money and have a valid Safaricom or Airtel number get a message.
router.post('/reminders', rateLimit({ windowMs: 60 * 1000, limit: 10 }), requireActiveSubscription, async (req, res) => {
  if (!canSend(req)) throw new HttpError(403, 'Only the owner or a manager can send SMS reminders');
  if (mode() === 'off') throw new HttpError(503, 'SMS reminders are not available right now. Try again later.');

  const { customerIds, message } = req.body || {};
  const ids = [...new Set(Array.isArray(customerIds) ? customerIds : [])].filter((x) => typeof x === 'string').slice(0, MAX_PER_REQUEST);
  if (!ids.length) throw new HttpError(400, 'Choose at least one customer');
  const template = String(message || DEFAULT_TEMPLATE).trim();
  if (!template) throw new HttpError(400, 'Write a message');

  // Branch managers can only remind customers of their branch
  const branchId = req.employee && req.employee.branch_id;
  const { rows: customers } = await query(
    `SELECT c.id, c.name, c.phone, c.branch_id,
            COALESCE((SELECT sum(CASE WHEN d.type = 'credit' THEN d.amount ELSE -d.amount END)
                        FROM debt_entries d WHERE d.customer_id = c.id AND d.business_id = c.business_id AND NOT d.deleted), 0)::float AS balance
       FROM customers c
      WHERE c.business_id = $1 AND c.id = ANY($2::uuid[]) AND NOT c.deleted`,
    [req.business.id, ids]
  );
  const found = new Map(customers.map((c) => [c.id, c]));

  const skipped = [];
  const outgoing = [];
  for (const id of ids) {
    const c = found.get(id);
    if (!c) { skipped.push({ id, reason: 'Not backed up yet. Connect to the internet and try again.' }); continue; }
    if (branchId && c.branch_id !== branchId) { skipped.push({ id, name: c.name, reason: 'Belongs to another branch' }); continue; }
    const phone = normalizePhone(c.phone);
    if (!phone) { skipped.push({ id, name: c.name, reason: 'No valid phone number' }); continue; }
    if (!(c.balance > 0)) { skipped.push({ id, name: c.name, reason: 'Does not owe anything' }); continue; }
    const text = fill(template, { name: c.name, balance: c.balance, shop: req.business.name });
    const segments = segmentsFor(text);
    if (segments > MAX_SEGMENTS) throw new HttpError(400, `The message for ${c.name} is too long. Keep it under about 300 characters.`);
    outgoing.push({ customer: c, phone, text, segments });
  }

  if (!outgoing.length) {
    return res.json({ sent: 0, failed: 0, used: 0, credits: req.business.sms_credits, skipped });
  }

  // Take the credits first so two phones sending at once cannot overspend
  const needed = outgoing.reduce((n, o) => n + o.segments, 0);
  const reserved = (await query(
    'UPDATE businesses SET sms_credits = sms_credits - $2 WHERE id = $1 AND sms_credits >= $2 RETURNING sms_credits',
    [req.business.id, needed]
  )).rows[0];
  if (!reserved) {
    throw new HttpError(402, `Not enough SMS left. This needs ${needed} and you have ${req.business.sms_credits}. Renew your plan to get more.`, 'NO_SMS_CREDITS');
  }

  // Send a few at a time
  const results = [];
  for (let i = 0; i < outgoing.length; i += 5) {
    const batch = outgoing.slice(i, i + 5);
    results.push(...await Promise.all(batch.map(async (o) => ({ o, r: await sendSms(o.phone, o.text) }))));
  }

  const refund = results.filter(({ r }) => !r.ok).reduce((n, { o }) => n + o.segments, 0);
  const final = await transaction(async (client) => {
    for (const { o, r } of results) {
      await client.query(
        `INSERT INTO sms_messages (business_id, customer_id, employee_id, phone, message, segments, status, provider_id, cost, error)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
        [req.business.id, o.customer.id, req.employee ? req.employee.id : null, o.phone, o.text, o.segments,
          r.status, r.providerId || null, r.cost || null, r.error || null]
      );
    }
    const row = refund
      ? (await client.query('UPDATE businesses SET sms_credits = sms_credits + $2 WHERE id = $1 RETURNING sms_credits', [req.business.id, refund])).rows[0]
      : reserved;
    return row.sms_credits;
  });

  const failed = results.filter(({ r }) => !r.ok);
  res.json({
    sent: results.length - failed.length,
    failed: failed.length,
    used: needed - refund,
    credits: final,
    skipped: [...skipped, ...failed.map(({ o, r }) => ({ id: o.customer.id, name: o.customer.name, reason: r.error || 'Could not send' }))],
  });
});

module.exports = router;
