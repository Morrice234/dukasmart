const express = require('express');
const { query, transaction } = require('../db');
const { activatePayment, failPayment } = require('../services/subscription');

const router = express.Router();

// Safaricom posts the STK result here. Always answer 200 so they stop retrying.
router.post('/callback/:secret', async (req, res) => {
  if (req.params.secret !== process.env.MPESA_CALLBACK_SECRET) {
    return res.status(404).end();
  }
  try {
    const cb = req.body && req.body.Body && req.body.Body.stkCallback;
    if (!cb) return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });

    const payment = (await query('SELECT * FROM payments WHERE checkout_request_id = $1', [cb.CheckoutRequestID])).rows[0];
    if (!payment) {
      console.warn('Callback for unknown checkout id', cb.CheckoutRequestID);
      return res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
    }

    await transaction(async (client) => {
      if (Number(cb.ResultCode) === 0) {
        const items = (cb.CallbackMetadata && cb.CallbackMetadata.Item) || [];
        const get = (name) => (items.find((i) => i.Name === name) || {}).Value;
        const paid = Number(get('Amount'));
        if (paid && paid < payment.amount) {
          await failPayment(client, payment.id, 'failed', `Underpaid: received ${paid}`);
          return;
        }
        await activatePayment(client, payment.id, get('MpesaReceiptNumber'), cb.ResultDesc);
      } else {
        const status = Number(cb.ResultCode) === 1032 ? 'cancelled' : 'failed';
        await failPayment(client, payment.id, status, cb.ResultDesc);
      }
    });
  } catch (err) {
    console.error('M-Pesa callback error', err);
  }
  res.json({ ResultCode: 0, ResultDesc: 'Accepted' });
});

module.exports = router;
