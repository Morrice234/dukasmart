const express = require('express');
const { query, transaction } = require('../db');
const { HttpError, normalizePhone, subscriptionInfo } = require('../utils');
const { requireUser, requireOwner } = require('../middleware/auth');
const mpesa = require('../services/mpesa');
const { activatePayment, failPayment } = require('../services/subscription');

const router = express.Router();

router.get('/plans', async (req, res) => {
  const { rows } = await query(
    'SELECT code, name, price_kes, duration_days, features FROM plans WHERE is_active ORDER BY sort_order, price_kes'
  );
  res.json({ plans: rows, trialDays: Number(process.env.TRIAL_DAYS || 7) });
});

router.get('/status', requireUser, async (req, res) => {
  res.json({ subscription: subscriptionInfo(req.business) });
});

// Starts an STK push. The phone shows the M-Pesa PIN prompt.
router.post('/pay', requireUser, requireOwner, async (req, res) => {
  const { planCode, phone } = req.body || {};
  const payPhone = normalizePhone(phone || req.business.phone);
  if (!payPhone) throw new HttpError(400, 'Enter a valid M-Pesa number');
  if (req.business.status === 'suspended') throw new HttpError(403, 'Account suspended. Contact support.');

  const plan = (await query('SELECT * FROM plans WHERE code = $1 AND is_active', [planCode])).rows[0];
  if (!plan) throw new HttpError(400, 'Choose a valid plan');

  const payment = (await query(
    `INSERT INTO payments (business_id, plan_code, amount, phone) VALUES ($1, $2, $3, $4) RETURNING *`,
    [req.business.id, plan.code, plan.price_kes, payPhone]
  )).rows[0];

  try {
    const stk = await mpesa.stkPush({
      phone: payPhone,
      amount: plan.price_kes,
      accountReference: 'DukaSmart',
      description: `${plan.name} plan`,
    });
    await query(
      'UPDATE payments SET merchant_request_id = $2, checkout_request_id = $3, updated_at = now() WHERE id = $1',
      [payment.id, stk.merchantRequestId, stk.checkoutRequestId]
    );
    res.status(201).json({ paymentId: payment.id, message: stk.customerMessage || 'Check your phone and enter your M-Pesa PIN' });
  } catch (err) {
    await query(`UPDATE payments SET status = 'failed', result_desc = $2, updated_at = now() WHERE id = $1`, [payment.id, err.message]);
    throw new HttpError(502, err.message);
  }
});

// The app polls this after starting a payment. If the callback has not arrived
// we ask Safaricom directly (at most every 20 seconds per payment).
router.get('/payments/:id', requireUser, async (req, res) => {
  let payment = (await query('SELECT * FROM payments WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id])).rows[0];
  if (!payment) throw new HttpError(404, 'Payment not found');

  const age = Date.now() - new Date(payment.created_at).getTime();
  const sinceCheck = payment.last_checked_at ? Date.now() - new Date(payment.last_checked_at).getTime() : Infinity;
  if (payment.status === 'pending' && payment.checkout_request_id && age > 20000 && sinceCheck > 20000) {
    await query('UPDATE payments SET last_checked_at = now() WHERE id = $1', [payment.id]);
    try {
      const result = await mpesa.stkQuery(payment.checkout_request_id);
      await transaction(async (client) => {
        if (result.state === 'success') await activatePayment(client, payment.id, null, result.desc);
        else if (result.state !== 'pending') await failPayment(client, payment.id, result.state, result.desc);
      });
    } catch (err) {
      console.warn('STK query failed', err.message);
    }
    payment = (await query('SELECT * FROM payments WHERE id = $1', [payment.id])).rows[0];
  }

  const business = (await query('SELECT * FROM businesses WHERE id = $1', [req.business.id])).rows[0];
  res.json({
    payment: { id: payment.id, status: payment.status, receipt: payment.mpesa_receipt, resultDesc: payment.result_desc },
    subscription: subscriptionInfo(business),
  });
});

router.get('/history', requireUser, async (req, res) => {
  const { rows } = await query(
    `SELECT id, plan_code, amount, status, mpesa_receipt, created_at FROM payments
      WHERE business_id = $1 ORDER BY created_at DESC LIMIT 50`,
    [req.business.id]
  );
  res.json({ payments: rows });
});

module.exports = router;
