const jwt = require('jsonwebtoken');
const { query } = require('../db');
const { HttpError, subscriptionInfo } = require('../utils');

function bearer(req) {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
}

// Mobile app auth. Sets req.business, and req.employee when an employee is signed in.
// req.role is 'owner', 'manager' or 'cashier'.
async function requireUser(req, res, next) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Not signed in');
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET);
  } catch {
    throw new HttpError(401, 'Session expired, please sign in again');
  }
  const { rows } = await query('SELECT * FROM businesses WHERE id = $1', [payload.bid]);
  if (!rows[0]) throw new HttpError(401, 'Account not found');
  req.business = rows[0];
  req.role = 'owner';
  req.employee = null;

  if (payload.eid) {
    const e = (await query('SELECT * FROM employees WHERE id = $1 AND business_id = $2', [payload.eid, payload.bid])).rows[0];
    if (!e || !e.is_active) throw new HttpError(401, 'Your staff account has been turned off. Talk to the owner.');
    req.employee = e;
    req.role = e.role;
    // Cheap activity tracking, at most once every 10 minutes
    if (!e.last_seen_at || Date.now() - new Date(e.last_seen_at).getTime() > 600000) {
      query('UPDATE employees SET last_seen_at = now() WHERE id = $1', [e.id]).catch(() => {});
    }
  }
  next();
}

function requireOwner(req, res, next) {
  if (req.role !== 'owner') throw new HttpError(403, 'Only the business owner can do this');
  next();
}

// Blocks writes when the trial or subscription has run out
function requireActiveSubscription(req, res, next) {
  const sub = subscriptionInfo(req.business);
  if (!sub.active) {
    throw new HttpError(402, sub.state === 'suspended' ? 'Account suspended' : 'Subscription expired', 'SUBSCRIPTION_INACTIVE');
  }
  next();
}

function requireAdmin(req, res, next) {
  const token = bearer(req);
  if (!token) throw new HttpError(401, 'Not signed in');
  try {
    const payload = jwt.verify(token, process.env.ADMIN_JWT_SECRET);
    if (payload.role !== 'admin') throw new Error('not admin');
    req.admin = payload;
  } catch {
    throw new HttpError(401, 'Admin session expired');
  }
  next();
}

module.exports = { requireUser, requireOwner, requireActiveSubscription, requireAdmin };
