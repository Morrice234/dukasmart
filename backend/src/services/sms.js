// Sends SMS through Africa's Talking (https://africastalking.com).
// Without AT_API_KEY the messages are only printed to the console, which is handy while developing.
// In production a missing key stops sending instead, so nobody loses SMS credits for messages that never went out.

const GSM = /^[A-Za-z0-9 \r\n@£$¥èéùìòÇØøÅåΔ_ΦΓΛΩΠΨΣΘΞÆæßÉ!"#¤%&'()*+,\-./:;<=>?¡ÄÖÑÜ§¿äöñüà^{}\\[~\]|€]*$/;

// How many SMS one message costs. Plain text fits 160 characters, or 153 per part when longer.
// Emojis and some symbols switch the whole message to 70 (67 per part).
function segmentsFor(text) {
  const plain = GSM.test(text);
  const single = plain ? 160 : 70;
  const part = plain ? 153 : 67;
  const len = [...text].length;
  return len <= single ? 1 : Math.ceil(len / part);
}

function configured() {
  return Boolean(process.env.AT_API_KEY && process.env.AT_USERNAME);
}

function mode() {
  if (configured()) return 'live';
  // Render sets RENDER=true, so a live server without a key never pretends to send
  return process.env.NODE_ENV === 'production' || process.env.RENDER ? 'off' : 'console';
}

// phone: 2547XXXXXXXX. Returns { ok, status: 'sent'|'failed'|'simulated', providerId, cost, error }
async function sendSms(phone, message) {
  const m = mode();
  if (m === 'off') return { ok: false, status: 'failed', error: 'SMS is not set up on the server' };
  if (m === 'console') {
    console.log(`[SMS not sent, no AT_API_KEY] to ${phone}: ${message}`);
    return { ok: true, status: 'simulated' };
  }

  const sandbox = process.env.AT_USERNAME === 'sandbox';
  const url = sandbox
    ? 'https://api.sandbox.africastalking.com/version1/messaging'
    : 'https://api.africastalking.com/version1/messaging';
  const form = new URLSearchParams({ username: process.env.AT_USERNAME, to: `+${phone}`, message });
  if (process.env.AT_SENDER_ID) form.set('from', process.env.AT_SENDER_ID);

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { apiKey: process.env.AT_API_KEY, Accept: 'application/json', 'Content-Type': 'application/x-www-form-urlencoded' },
      body: form.toString(),
      signal: AbortSignal.timeout(20000),
    });
    const text = await res.text();
    let data = null;
    try { data = JSON.parse(text); } catch { /* AT sends plain text on some errors */ }
    const r = data && data.SMSMessageData && data.SMSMessageData.Recipients && data.SMSMessageData.Recipients[0];
    if (!res.ok || !r) {
      const error = (data && data.SMSMessageData && data.SMSMessageData.Message) || text.slice(0, 200) || `HTTP ${res.status}`;
      console.error(`SMS to ${phone} failed: ${error}`);
      return { ok: false, status: 'failed', error };
    }
    // 100 Processed, 101 Sent, 102 Queued are all good
    const ok = [100, 101, 102].includes(Number(r.statusCode));
    if (!ok) console.error(`SMS to ${phone} rejected: ${r.status}`);
    return { ok, status: ok ? 'sent' : 'failed', providerId: r.messageId || null, cost: r.cost || null, error: ok ? null : r.status };
  } catch (e) {
    console.error(`SMS to ${phone} failed: ${e.message}`);
    return { ok: false, status: 'failed', error: e.name === 'TimeoutError' ? 'SMS service took too long' : e.message };
  }
}

module.exports = { sendSms, segmentsFor, mode };
