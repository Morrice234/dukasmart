// M-Pesa till payments recorded as sales automatically (Daraja C2B).
const crypto = require('crypto');

// Key for encrypting shops' Daraja secrets. Set TILL_ENCRYPTION_KEY (any long random string) on the server.
// Changing it later makes saved secrets unreadable, and those tills would need their keys entered again.
function key() {
  const source = process.env.TILL_ENCRYPTION_KEY || process.env.JWT_SECRET;
  return crypto.createHash('sha256').update(String(source)).digest();
}

function encrypt(text) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const data = Buffer.concat([cipher.update(String(text), 'utf8'), cipher.final()]);
  return `v1:${iv.toString('base64')}:${cipher.getAuthTag().toString('base64')}:${data.toString('base64')}`;
}

function decrypt(stored) {
  const [, iv, tag, data] = String(stored).split(':');
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), Buffer.from(iv, 'base64'));
  decipher.setAuthTag(Buffer.from(tag, 'base64'));
  return Buffer.concat([decipher.update(Buffer.from(data, 'base64')), decipher.final()]).toString('utf8');
}

// Same sale id for the same M-Pesa code, here and on the phone (src/utils/mpesaSms.js), so a payment
// recorded automatically and also pasted from SMS is still one sale.
function uuidFrom(text) {
  const h = crypto.createHash('sha256').update(text).digest('hex');
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}

function saleIdFor(businessId, code) {
  return uuidFrom(`mpesa:${businessId}:${String(code).toUpperCase()}`);
}

// The sale or deni payment created by a payment prompt
function recordIdForRequest(requestId) {
  return uuidFrom(`stkreq:${requestId}`);
}

// Daraja TransTime is YYYYMMDDHHmmss in Kenyan time (UTC+3)
function parseTransTime(t) {
  const m = /^(\d{4})(\d{2})(\d{2})(\d{2})(\d{2})(\d{2})$/.exec(String(t || ''));
  if (!m) return Date.now();
  return Date.UTC(+m[1], +m[2] - 1, +m[3], +m[4] - 3, +m[5], +m[6]);
}

function baseUrl(environment) {
  return environment === 'sandbox' ? 'https://sandbox.safaricom.co.ke' : 'https://api.safaricom.co.ke';
}

async function tokenFor(conn) {
  const auth = Buffer.from(`${decrypt(conn.consumer_key)}:${decrypt(conn.consumer_secret)}`).toString('base64');
  const res = await fetch(`${baseUrl(conn.environment)}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
    signal: AbortSignal.timeout(20000),
  });
  if (!res.ok) throw new Error(`Safaricom did not accept the consumer key and secret (${res.status}). Check they are from the till's live app.`);
  return (await res.json()).access_token;
}

async function darajaPost(conn, path, body) {
  const token = await tokenFor(conn);
  const res = await fetch(`${baseUrl(conn.environment)}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20000),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

function callbackUrls(conn) {
  // Daraja rejects addresses containing words like "mpesa" or "safaricom"
  const base = `${String(process.env.PUBLIC_BASE_URL || '').replace(/\/$/, '')}/api/payhook/till/${conn.callback_token}`;
  return { confirmation: `${base}/c`, validation: `${base}/v`, stk: `${base}/s` };
}

// Tells Safaricom where to send this till's payments
async function registerUrls(conn) {
  const urls = callbackUrls(conn);
  const path = conn.environment === 'sandbox' ? '/mpesa/c2b/v1/registerurl' : '/mpesa/c2b/v2/registerurl';
  const { ok, data } = await darajaPost(conn, path, {
    ShortCode: conn.shortcode,
    ResponseType: 'Completed', // if our server is down, Safaricom still completes the payment
    ConfirmationURL: urls.confirmation,
    ValidationURL: urls.validation,
  });
  const success = ok && (String(data.ResponseCode) === '0' || /success/i.test(String(data.ResponseDescription || '')));
  if (!success) {
    const msg = data.errorMessage || data.ResponseDescription || `Safaricom answered ${JSON.stringify(data).slice(0, 200)}`;
    throw new Error(msg);
  }
  return data;
}

// Sandbox only: makes Safaricom send a fake payment to the confirmation URL
async function simulate(conn, amount) {
  if (conn.environment !== 'sandbox') throw new Error('Test payments only work with a sandbox connection');
  const { ok, data } = await darajaPost(conn, '/mpesa/c2b/v1/simulate', {
    ShortCode: conn.shortcode,
    CommandID: 'CustomerBuyGoodsOnline',
    Amount: Math.max(1, Math.round(Number(amount) || 10)),
    Msisdn: '254708374149',
    BillRefNumber: '',
  });
  if (!ok) throw new Error(data.errorMessage || data.ResponseDescription || 'Simulation failed');
  return data;
}

// ---- Payment prompts (M-Pesa Express / STK push) from the shop's own till ----

function eatTimestamp() {
  return new Date(Date.now() + 3 * 3600 * 1000).toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function stkFields(conn) {
  const ts = eatTimestamp();
  return {
    BusinessShortCode: conn.shortcode,
    Password: Buffer.from(`${conn.shortcode}${decrypt(conn.passkey)}${ts}`).toString('base64'),
    Timestamp: ts,
  };
}

async function stkPush(conn, { phone, amount, reference, description }) {
  const isTill = conn.kind !== 'paybill';
  const { ok, data } = await darajaPost(conn, '/mpesa/stkpush/v1/processrequest', {
    ...stkFields(conn),
    TransactionType: isTill ? 'CustomerBuyGoodsOnline' : 'CustomerPayBillOnline',
    Amount: amount,
    PartyA: phone,
    PartyB: isTill ? (conn.till_number || conn.shortcode) : conn.shortcode,
    PhoneNumber: phone,
    CallBackURL: callbackUrls(conn).stk,
    AccountReference: String(reference || 'Payment').replace(/[^A-Za-z0-9 ]/g, '').slice(0, 12) || 'Payment',
    TransactionDesc: String(description || 'Payment').slice(0, 13),
  });
  if (!ok || String(data.ResponseCode) !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'Safaricom did not send the prompt');
  }
  return { merchantRequestId: data.MerchantRequestID, checkoutRequestId: data.CheckoutRequestID };
}

// Returns { state: 'paid' | 'failed' | 'cancelled' | 'pending', desc }. Safaricom does not give the receipt here.
async function stkQuery(conn, checkoutRequestId) {
  const { data } = await darajaPost(conn, '/mpesa/stkpushquery/v1/query', { ...stkFields(conn), CheckoutRequestID: checkoutRequestId });
  if (data.ResultCode === undefined) return { state: 'pending', desc: data.errorMessage || 'Still waiting' };
  const code = String(data.ResultCode);
  if (code === '0') return { state: 'paid', desc: data.ResultDesc };
  if (code === '1032') return { state: 'cancelled', desc: 'The customer cancelled' };
  if (code === '1037') return { state: 'failed', desc: 'The customer\'s phone could not be reached' };
  if (code === '2001') return { state: 'failed', desc: 'Wrong M-Pesa PIN' };
  if (code === '1') return { state: 'failed', desc: 'Not enough money in M-Pesa' };
  return { state: 'failed', desc: data.ResultDesc || 'Payment failed' };
}

// Removes a sale the till notification created when the same money belongs to a payment prompt
async function dropDuplicateSale(client, businessId, saleId, keepId) {
  if (!saleId || saleId === keepId) return;
  await client.query(
    `UPDATE sales SET deleted = TRUE, updated_at = $3, version = nextval('sync_version_seq')
      WHERE id = $1 AND business_id = $2 AND NOT deleted`,
    [saleId, businessId, Date.now()]
  );
}

// Marks a prompt as paid and records the sale or deni payment. Safe to call more than once,
// and a later call with the receipt fills it in.
async function settleRequest(client, request, { receipt = null, desc = null } = {}) {
  const req = (await client.query('SELECT * FROM payment_requests WHERE id = $1 FOR UPDATE', [request.id])).rows[0];
  if (!req || req.status === 'failed' || req.status === 'cancelled') return req;
  const recordId = recordIdForRequest(req.id);
  const now = Date.now();
  const code = receipt ? String(receipt).toUpperCase() : null;

  if (req.status === 'pending') {
    if (req.purpose === 'sale') {
      await client.query(
        `INSERT INTO sales (id, business_id, amount, method, description, occurred_at, branch_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'mpesa', $4, $5, $6, $7, $5, $5) ON CONFLICT (id) DO NOTHING`,
        [recordId, req.business_id, req.amount, `M-Pesa prompt${code ? ` ${code}` : ''}`, now, req.branch_id, req.employee_id]
      );
    } else {
      await client.query(
        `INSERT INTO debt_entries (id, business_id, customer_id, type, amount, note, occurred_at, branch_id, created_by, created_at, updated_at)
         VALUES ($1, $2, $3, 'payment', $4, $5, $6, $7, $8, $6, $6) ON CONFLICT (id) DO NOTHING`,
        [recordId, req.business_id, req.customer_id, req.amount, `Paid via M-Pesa${code ? ` ${code}` : ''}`, now, req.branch_id, req.employee_id]
      );
    }
  }

  await client.query(
    `UPDATE payment_requests SET status = 'paid', receipt = COALESCE(receipt, $2), result_desc = COALESCE($3, result_desc),
            record_id = $4, updated_at = now() WHERE id = $1`,
    [req.id, code, desc, recordId]
  );

  // Link to the till notification for the same money, whichever arrived first
  let tp = null;
  if (code) {
    tp = (await client.query('SELECT * FROM till_payments WHERE business_id = $1 AND trans_id = $2', [req.business_id, code])).rows[0];
  } else {
    // No receipt yet: a till notification for the same amount in the last 5 minutes that nothing else claimed
    tp = (await client.query(
      `SELECT tp.* FROM till_payments tp
        WHERE tp.business_id = $1 AND tp.amount = $2 AND tp.created_at > now() - interval '5 minutes'
          AND NOT EXISTS (SELECT 1 FROM payment_requests pr WHERE pr.business_id = tp.business_id AND pr.record_id = tp.sale_id)
        ORDER BY tp.created_at DESC LIMIT 1`,
      [req.business_id, req.amount]
    )).rows[0];
  }
  if (tp) {
    await dropDuplicateSale(client, req.business_id, tp.sale_id, recordId);
    await client.query('UPDATE till_payments SET sale_id = $2 WHERE id = $1', [tp.id, recordId]);
    if (!code) await client.query('UPDATE payment_requests SET receipt = $2 WHERE id = $1 AND receipt IS NULL', [req.id, tp.trans_id]);
  } else if (code) {
    await client.query(
      `INSERT INTO till_payments (business_id, trans_id, amount, payer_phone, paid_at, sale_id, raw)
       VALUES ($1, $2, $3, $4, $5, $6, $7) ON CONFLICT (business_id, trans_id) DO NOTHING`,
      [req.business_id, code, req.amount, req.phone, now, recordId, { source: 'prompt', requestId: req.id }]
    );
  }
  return (await client.query('SELECT * FROM payment_requests WHERE id = $1', [req.id])).rows[0];
}

// Records one confirmation as a sale. Safe to call twice for the same payment.
async function recordPayment(client, conn, body) {
  const code = String(body.TransID || '').trim().toUpperCase();
  const amount = Number(body.TransAmount);
  if (!code || !(amount > 0)) return { skipped: 'missing code or amount' };

  const name = [body.FirstName, body.MiddleName, body.LastName].filter(Boolean).join(' ').trim();
  const paidAt = parseTransTime(body.TransTime);
  const saleId = saleIdFor(conn.business_id, code);

  const inserted = (await client.query(
    `INSERT INTO till_payments (business_id, trans_id, amount, payer_name, payer_phone, bill_ref, shortcode, paid_at, sale_id, raw)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
     ON CONFLICT (business_id, trans_id) DO NOTHING RETURNING id`,
    [conn.business_id, code, amount, name || null, body.MSISDN ? String(body.MSISDN).slice(0, 80) : null,
      body.BillRefNumber || null, body.BusinessShortCode ? String(body.BusinessShortCode) : null, paidAt, saleId, body]
  )).rows[0];
  if (!inserted) return { duplicate: true };

  // Money from a payment prompt already has its sale or deni payment: link it instead of adding a sale
  const claim = (await client.query(
    `SELECT id, record_id FROM payment_requests
      WHERE business_id = $1 AND (receipt = $2 OR (status = 'paid' AND receipt IS NULL AND amount = $3 AND updated_at > now() - interval '5 minutes'))
      ORDER BY (receipt = $2) DESC NULLS LAST, updated_at DESC LIMIT 1`,
    [conn.business_id, code, amount]
  )).rows[0];
  if (claim && claim.record_id) {
    await client.query('UPDATE till_payments SET sale_id = $2 WHERE business_id = $1 AND trans_id = $3', [conn.business_id, claim.record_id, code]);
    await client.query('UPDATE payment_requests SET receipt = COALESCE(receipt, $2) WHERE id = $1', [claim.id, code]);
    await client.query('UPDATE till_connections SET last_payment_at = now() WHERE id = $1', [conn.id]);
    return { linked: claim.id };
  }

  let branchId = conn.branch_id;
  if (!branchId) {
    branchId = (await client.query(
      'SELECT id FROM branches WHERE business_id = $1 AND NOT deleted ORDER BY created_at LIMIT 1', [conn.business_id]
    )).rows[0]?.id || null;
  }
  const now = Date.now();
  // Same id as a pasted SMS of this payment, so nothing is counted twice
  await client.query(
    `INSERT INTO sales (id, business_id, amount, method, description, occurred_at, branch_id, created_at, updated_at)
     VALUES ($1, $2, $3, 'mpesa', $4, $5, $6, $7, $7)
     ON CONFLICT (id) DO NOTHING`,
    [saleId, conn.business_id, amount, `M-Pesa ${code}${name ? ` from ${name}` : ''}`, paidAt, branchId, now]
  );
  await client.query('UPDATE till_connections SET last_payment_at = now(), status = CASE WHEN status = \'pending\' THEN \'active\' ELSE status END WHERE id = $1', [conn.id]);
  return { saleId };
}

function publicConnection(c) {
  if (!c) return null;
  return {
    id: c.id,
    environment: c.environment,
    shortcode: c.shortcode,
    tillNumber: c.till_number,
    branchId: c.branch_id,
    status: c.status,
    lastError: c.last_error,
    registeredAt: c.registered_at,
    lastPaymentAt: c.last_payment_at,
    kind: c.kind,
    stkEnabled: Boolean(c.passkey),
  };
}

module.exports = {
  encrypt, decrypt, uuidFrom, saleIdFor, recordIdForRequest, parseTransTime, registerUrls, simulate, recordPayment,
  callbackUrls, publicConnection, stkPush, stkQuery, settleRequest,
};
