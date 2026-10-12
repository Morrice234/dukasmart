// Safaricom Daraja STK Push (Lipa Na M-Pesa Online)
const BASE_URL = process.env.MPESA_ENV === 'production'
  ? 'https://api.safaricom.co.ke'
  : 'https://sandbox.safaricom.co.ke';

let cachedToken = null;
let tokenExpiresAt = 0;

async function getAccessToken() {
  if (cachedToken && Date.now() < tokenExpiresAt) return cachedToken;
  const auth = Buffer.from(`${process.env.MPESA_CONSUMER_KEY}:${process.env.MPESA_CONSUMER_SECRET}`).toString('base64');
  const res = await fetch(`${BASE_URL}/oauth/v1/generate?grant_type=client_credentials`, {
    headers: { Authorization: `Basic ${auth}` },
  });
  if (!res.ok) throw new Error(`M-Pesa auth failed (${res.status})`);
  const data = await res.json();
  cachedToken = data.access_token;
  // Tokens last 3600s, refresh a minute early
  tokenExpiresAt = Date.now() + (Number(data.expires_in || 3599) - 60) * 1000;
  return cachedToken;
}

// Daraja expects YYYYMMDDHHmmss in Kenyan time
function timestamp() {
  const eat = new Date(Date.now() + 3 * 60 * 60 * 1000);
  return eat.toISOString().replace(/[-:TZ.]/g, '').slice(0, 14);
}

function password(ts) {
  return Buffer.from(`${process.env.MPESA_SHORTCODE}${process.env.MPESA_PASSKEY}${ts}`).toString('base64');
}

async function darajaPost(path, body) {
  const token = await getAccessToken();
  const res = await fetch(`${BASE_URL}${path}`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, data };
}

async function stkPush({ phone, amount, accountReference, description }) {
  const ts = timestamp();
  // Daraja rejects callback addresses containing words like "mpesa" or "safaricom", so this path avoids them
  const callbackUrl = `${process.env.PUBLIC_BASE_URL.replace(/\/$/, '')}/api/payhook/callback/${process.env.MPESA_CALLBACK_SECRET}`;
  const { ok, data } = await darajaPost('/mpesa/stkpush/v1/processrequest', {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password(ts),
    Timestamp: ts,
    TransactionType: process.env.MPESA_TRANSACTION_TYPE || 'CustomerPayBillOnline',
    Amount: Math.round(amount),
    PartyA: phone,
    PartyB: process.env.MPESA_PARTY_B || process.env.MPESA_SHORTCODE,
    PhoneNumber: phone,
    CallBackURL: callbackUrl,
    AccountReference: String(accountReference).slice(0, 12),
    TransactionDesc: String(description).slice(0, 13),
  });
  if (!ok || data.ResponseCode !== '0') {
    throw new Error(data.errorMessage || data.ResponseDescription || 'Could not start M-Pesa payment');
  }
  return {
    merchantRequestId: data.MerchantRequestID,
    checkoutRequestId: data.CheckoutRequestID,
    customerMessage: data.CustomerMessage,
  };
}

// Returns { state: 'success' | 'failed' | 'cancelled' | 'pending', desc }
async function stkQuery(checkoutRequestId) {
  const ts = timestamp();
  const { data } = await darajaPost('/mpesa/stkpushquery/v1/query', {
    BusinessShortCode: process.env.MPESA_SHORTCODE,
    Password: password(ts),
    Timestamp: ts,
    CheckoutRequestID: checkoutRequestId,
  });
  if (data.ResultCode === undefined) return { state: 'pending', desc: data.errorMessage || 'Still processing' };
  const code = String(data.ResultCode);
  if (code === '0') return { state: 'success', desc: data.ResultDesc };
  if (code === '1032') return { state: 'cancelled', desc: data.ResultDesc };
  return { state: 'failed', desc: data.ResultDesc };
}

module.exports = { stkPush, stkQuery };
