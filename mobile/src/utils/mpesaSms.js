import * as Crypto from 'expo-crypto';

// Reads money-received messages from M-Pesa (till, Pochi la Biashara, personal line) pasted by the owner.
// Messages for money sent or paid out are ignored, since those are not sales.

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, oct: 9, nov: 10, dec: 11 };

function parseDate(msg) {
  // "on 14/10/26 at 2:15 PM" or "on 14/10/2026 at 14:15"
  const m = /\bon\s+(\d{1,2})\/(\d{1,2})\/(\d{2,4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(msg);
  if (m) {
    let year = Number(m[3]);
    if (year < 100) year += 2000;
    let hour = Number(m[4]);
    const ap = (m[6] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    // Kenyan time (UTC+3), whatever timezone the phone is set to
    return Date.UTC(year, Number(m[2]) - 1, Number(m[1]), hour - 3, Number(m[5]));
  }
  // "on 14 Oct 2026 at 2:15 PM"
  const w = /\bon\s+(\d{1,2})\s+([A-Za-z]{3})[a-z]*\s+(\d{4})\s+at\s+(\d{1,2}):(\d{2})\s*(AM|PM)?/i.exec(msg);
  if (w && MONTHS[w[2].toLowerCase()] !== undefined) {
    let hour = Number(w[4]);
    const ap = (w[6] || '').toUpperCase();
    if (ap === 'PM' && hour < 12) hour += 12;
    if (ap === 'AM' && hour === 12) hour = 0;
    return Date.UTC(Number(w[3]), MONTHS[w[2].toLowerCase()], Number(w[1]), hour - 3, Number(w[5]));
  }
  return null;
}

function cleanName(raw) {
  return String(raw || '')
    .replace(/\s+/g, ' ')
    .replace(/[.,]+$/, '')
    .trim()
    .split(' ')
    .map((p) => (p.length > 1 ? p[0].toUpperCase() + p.slice(1).toLowerCase() : p.toUpperCase()))
    .join(' ');
}

// Returns [{ code, amount, name, phone, occurredAt }] for every received payment found in the text
export function parseMpesaMessages(text) {
  const source = String(text || '').replace(/\r/g, '');
  // Each message starts with a 10 character code followed by "Confirmed"
  const starts = [];
  const re = /\b([A-Z0-9]{10})\s+Confirmed/g;
  let m;
  while ((m = re.exec(source))) starts.push({ code: m[1], index: m.index });

  const out = [];
  const seen = new Set();
  starts.forEach((s, i) => {
    const msg = source.slice(s.index, i + 1 < starts.length ? starts[i + 1].index : undefined).replace(/\s+/g, ' ');
    if (!/received/i.test(msg) || /\b(sent to|paid to|withdraw|reversed|failed)\b/i.test(msg.split(/received/i)[0])) return;

    // "received Ksh500.00 from" or "Ksh500.00 received from"
    const amt = /received\s+(?:Ksh|KES)\.?\s?([\d,]+(?:\.\d{1,2})?)/i.exec(msg)
      || /(?:Ksh|KES)\.?\s?([\d,]+(?:\.\d{1,2})?)\s+received/i.exec(msg);
    if (!amt) return;
    const amount = Number(amt[1].replace(/,/g, ''));
    if (!(amount > 0) || seen.has(s.code)) return;

    // "from JOHN DOE 0712345678 on" / "from JOHN DOE 2547******78 on" / "from JOHN DOE on"
    const from = /\bfrom\s+(.+?)\s+(?:on\s+\d|\.\s)/i.exec(msg);
    let name = '';
    let phone = '';
    if (from) {
      const parts = from[1].trim();
      const ph = /((?:\+?254|0)[\d*]{6,12})\s*$/.exec(parts);
      if (ph) { phone = ph[1]; name = parts.slice(0, ph.index); } else { name = parts; }
    }
    seen.add(s.code);
    out.push({ code: s.code, amount, name: cleanName(name), phone, occurredAt: parseDate(msg) || Date.now() });
  });
  return out;
}

// Same id the server gives an automatically recorded till payment (backend/src/services/till.js),
// so the same M-Pesa code is never counted as two sales.
export async function saleIdFor(businessId, code) {
  const h = await Crypto.digestStringAsync(Crypto.CryptoDigestAlgorithm.SHA256, `mpesa:${businessId}:${String(code).toUpperCase()}`);
  const variant = ((parseInt(h[16], 16) & 0x3) | 0x8).toString(16);
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-5${h.slice(13, 16)}-${variant}${h.slice(17, 20)}-${h.slice(20, 32)}`;
}
