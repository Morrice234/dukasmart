// What the app shows about the shop's connected till
const express = require('express');
const rateLimit = require('express-rate-limit');
const { query, transaction } = require('../db');
const { HttpError, normalizePhone } = require('../utils');
const { requireUser, requireActiveSubscription } = require('../middleware/auth');
const { publicConnection, stkPush, stkQuery, settleRequest } = require('../services/till');

const router = express.Router();
router.use(requireUser);

router.get('/', async (req, res) => {
  const conn = (await query('SELECT * FROM till_connections WHERE business_id = $1', [req.business.id])).rows[0];
  const canSeePayments = req.role !== 'cashier';
  const payments = conn && canSeePayments
    ? (await query(
      `SELECT trans_id, amount::float AS amount, payer_name, paid_at FROM till_payments
        WHERE business_id = $1 ORDER BY paid_at DESC LIMIT 30`, [req.business.id])).rows
    : [];
  const today = conn && canSeePayments
    ? (await query(
      `SELECT count(*)::int AS n, COALESCE(sum(amount), 0)::float AS total FROM till_payments
        WHERE business_id = $1 AND to_timestamp(paid_at / 1000) AT TIME ZONE 'Africa/Nairobi' >= date_trunc('day', now() AT TIME ZONE 'Africa/Nairobi')`,
      [req.business.id])).rows[0]
    : null;
  const c = publicConnection(conn);
  if (c) delete c.lastError;
  res.json({ connection: c, payments, today });
});

function publicRequest(r) {
  return { id: r.id, status: r.status, amount: r.amount, receipt: r.receipt, resultDesc: r.result_desc, recordId: r.record_id, purpose: r.purpose };
}

// Sends an M-Pesa prompt to the customer's phone; the money goes to the shop's own till.
// Body: { amount, phone, purpose: 'sale' | 'deni', customerId?, branchId? }
router.post('/request', rateLimit({ windowMs: 60 * 1000, limit: 20 }), requireActiveSubscription, async (req, res) => {
  const conn = (await query(
    `SELECT * FROM till_connections WHERE business_id = $1 AND status IN ('active', 'pending')`, [req.business.id]
  )).rows[0];
  if (!conn || !conn.passkey) throw new HttpError(400, 'M-Pesa prompts are not set up for this shop yet');

  const { amount, phone, purpose = 'sale', customerId, branchId } = req.body || {};
  const value = Math.ceil(Number(amount));
  if (!(value >= 1) || value > 250000) throw new HttpError(400, 'Enter an amount between KSh 1 and KSh 250,000');
  const payPhone = normalizePhone(phone);
  if (!payPhone) throw new HttpError(400, 'Enter the customer\'s Safaricom number, e.g. 0712345678');
  if (!['sale', 'deni'].includes(purpose)) throw new HttpError(400, 'Invalid purpose');

  // Staff tied to one branch always record in their branch
  let branch = (req.employee && req.employee.branch_id) || branchId || null;
  let customer = null;
  if (purpose === 'deni') {
    customer = (await query('SELECT id, branch_id FROM customers WHERE id = $1 AND business_id = $2 AND NOT deleted', [customerId, req.business.id])).rows[0];
    if (!customer) throw new HttpError(400, 'This customer is not backed up yet. Connect to the internet and try again.');
    branch = customer.branch_id || branch;
  }
  if (branch) {
    const ok = (await query('SELECT 1 FROM branches WHERE id = $1 AND business_id = $2', [branch, req.business.id])).rows[0];
    if (!ok) branch = null;
  }

  const request = (await query(
    `INSERT INTO payment_requests (business_id, employee_id, branch_id, purpose, customer_id, phone, amount)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [req.business.id, req.employee ? req.employee.id : null, branch, purpose, customer ? customer.id : null, payPhone, value]
  )).rows[0];

  try {
    const stk = await stkPush(conn, { phone: payPhone, amount: value, reference: req.business.name, description: purpose === 'deni' ? 'Deni' : 'Purchase' });
    await query('UPDATE payment_requests SET merchant_request_id = $2, checkout_request_id = $3 WHERE id = $1', [request.id, stk.merchantRequestId, stk.checkoutRequestId]);
  } catch (e) {
    await query(`UPDATE payment_requests SET status = 'failed', result_desc = $2 WHERE id = $1`, [request.id, e.message]);
    throw new HttpError(502, e.message);
  }
  res.status(201).json({ request: publicRequest({ ...request, status: 'pending' }) });
});

// The app polls this while the customer enters their PIN. If Safaricom's answer is late we ask them directly.
router.get('/request/:id', async (req, res) => {
  let r = (await query('SELECT * FROM payment_requests WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id])).rows[0];
  if (!r) throw new HttpError(404, 'Payment not found');

  const age = Date.now() - new Date(r.created_at).getTime();
  const sinceCheck = r.last_checked_at ? Date.now() - new Date(r.last_checked_at).getTime() : Infinity;
  if (r.status === 'pending' && r.checkout_request_id && age > 15000 && sinceCheck > 10000) {
    await query('UPDATE payment_requests SET last_checked_at = now() WHERE id = $1', [r.id]);
    const conn = (await query('SELECT * FROM till_connections WHERE business_id = $1', [req.business.id])).rows[0];
    try {
      const result = await stkQuery(conn, r.checkout_request_id);
      if (result.state === 'paid') {
        await transaction((client) => settleRequest(client, r, { desc: result.desc }));
      } else if (result.state !== 'pending') {
        await query(`UPDATE payment_requests SET status = $2, result_desc = $3, updated_at = now() WHERE id = $1 AND status = 'pending'`, [r.id, result.state, result.desc]);
      } else if (age > 3 * 60 * 1000) {
        await query(`UPDATE payment_requests SET status = 'failed', result_desc = 'No answer from the customer', updated_at = now() WHERE id = $1 AND status = 'pending'`, [r.id]);
      }
    } catch (e) {
      console.warn('Payment prompt check failed', e.message);
    }
    r = (await query('SELECT * FROM payment_requests WHERE id = $1', [r.id])).rows[0];
  }
  res.json({ request: publicRequest(r) });
});

module.exports = router;
