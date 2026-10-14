// Safaricom posts every payment made to a connected till here. Always answer quickly with ResultCode 0.
const express = require('express');
const { query, transaction } = require('../db');
const { recordPayment, settleRequest } = require('../services/till');

const router = express.Router();
const ACCEPT = { ResultCode: 0, ResultDesc: 'Accepted' };

async function connectionFor(token) {
  if (!/^[a-f0-9]{32,}$/.test(String(token))) return null;
  return (await query('SELECT * FROM till_connections WHERE callback_token = $1', [token])).rows[0] || null;
}

// Validation: only called if Safaricom turned it on for the till. We never block a customer's payment.
router.post('/:token/v', (req, res) => res.json(ACCEPT));

// Result of a payment prompt sent from the app
router.post('/:token/s', async (req, res) => {
  try {
    const conn = await connectionFor(req.params.token);
    if (!conn) return res.status(404).end();
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb) return res.json(ACCEPT);
    const request = (await query(
      'SELECT * FROM payment_requests WHERE checkout_request_id = $1 AND business_id = $2', [cb.CheckoutRequestID, conn.business_id]
    )).rows[0];
    if (!request) return res.json(ACCEPT);

    if (Number(cb.ResultCode) === 0) {
      const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
      const get = (name) => (items.find((i) => i.Name === name) || {}).Value;
      await transaction((client) => settleRequest(client, request, { receipt: get('MpesaReceiptNumber'), desc: cb.ResultDesc }));
    } else {
      await query(
        `UPDATE payment_requests SET status = $2, result_desc = $3, updated_at = now() WHERE id = $1 AND status = 'pending'`,
        [request.id, Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed', cb.ResultDesc || 'Payment failed']
      );
    }
  } catch (e) {
    console.error('Payment prompt callback failed', e);
  }
  res.json(ACCEPT);
});

router.post('/:token/c', async (req, res) => {
  try {
    const conn = await connectionFor(req.params.token);
    if (!conn) return res.status(404).end();
    if (conn.status === 'disabled') return res.json(ACCEPT);
    const body = req.body || {};
    if (body.BusinessShortCode && String(body.BusinessShortCode) !== String(conn.shortcode)) {
      console.warn(`Till payment for shortcode ${body.BusinessShortCode} arrived on the link for ${conn.shortcode}; recording it anyway`);
    }
    const result = await transaction((client) => recordPayment(client, conn, body));
    if (result.saleId) console.log(`Till payment ${body.TransID} KSh ${body.TransAmount} recorded for business ${conn.business_id}`);
  } catch (e) {
    // Still accept: with ResponseType "Completed" a failure here must not confuse Safaricom. The error is in the logs.
    console.error('Till confirmation failed', e);
  }
  res.json(ACCEPT);
});

module.exports = router;
