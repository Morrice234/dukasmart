// Marks a pending payment as successful and extends the business subscription.
// Safe to call more than once: only the first call that flips the status does anything.
async function activatePayment(client, paymentId, receipt, resultDesc) {
  const { rows } = await client.query(
    `UPDATE payments
        SET status = 'success', mpesa_receipt = COALESCE($2, mpesa_receipt),
            result_desc = COALESCE($3, result_desc), updated_at = now()
      WHERE id = $1 AND status = 'pending'
      RETURNING *`,
    [paymentId, receipt || null, resultDesc || null]
  );
  const payment = rows[0];
  if (!payment) return false;

  const plan = (await client.query('SELECT * FROM plans WHERE code = $1', [payment.plan_code])).rows[0];
  await extendSubscription(client, payment.business_id, payment.plan_code, plan.duration_days);
  await require('./referrals').onPaymentSuccess(client, payment);
  return true;
}

// New period starts from today, or from the current end date if they renew early
async function extendSubscription(client, businessId, planCode, days) {
  await client.query(
    `UPDATE businesses
        SET plan_code = $2,
            subscription_ends_at = GREATEST(now(), COALESCE(subscription_ends_at, now())) + make_interval(days => $3)
      WHERE id = $1`,
    [businessId, planCode, days]
  );
}

async function failPayment(client, paymentId, status, resultDesc) {
  await client.query(
    `UPDATE payments SET status = $2, result_desc = $3, updated_at = now()
      WHERE id = $1 AND status = 'pending'`,
    [paymentId, status, resultDesc || null]
  );
}

module.exports = { activatePayment, extendSubscription, failPayment };
