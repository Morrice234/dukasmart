const crypto = require('crypto');
const bcrypt = require('bcryptjs');

// Random 4-digit PIN for an owner or staff member who forgot theirs. Avoids obvious ones like 1234.
function temporaryPin() {
  const weak = new Set(['0000', '1111', '1234', '4321', '1212', '2222', '9999']);
  let pin;
  do {
    pin = String(crypto.randomInt(0, 10000)).padStart(4, '0');
  } while (weak.has(pin));
  return pin;
}

async function hashPin(pin) {
  return bcrypt.hash(String(pin), 10);
}

// Permanently removes a business and everything recorded under it: sales, expenses, deni,
// customers, stock, branches, staff, payments and referral records where it was the new shop.
// Referrals it made for other shops are kept but no longer point to it. Leads that converted
// into it are kept as leads.
async function deleteBusiness(client, businessId) {
  const { rows } = await client.query('DELETE FROM businesses WHERE id = $1 RETURNING name, phone', [businessId]);
  return rows[0] || null;
}

module.exports = { temporaryPin, hashPin, deleteBusiness };
