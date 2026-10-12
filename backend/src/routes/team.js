const express = require('express');
const bcrypt = require('bcryptjs');
const { query } = require('../db');
const { HttpError, normalizePhone } = require('../utils');
const { requireUser, requireOwner, requireActiveSubscription } = require('../middleware/auth');
const { getLimits } = require('../services/limits');

const router = express.Router();
router.use(requireUser);

function shape(e) {
  return {
    id: e.id, name: e.name, phone: e.phone, role: e.role, branchId: e.branch_id,
    isActive: e.is_active, lastSeenAt: e.last_seen_at, createdAt: e.created_at,
  };
}

async function checkBranch(businessId, branchId) {
  if (!branchId) return null;
  const b = (await query('SELECT id FROM branches WHERE id = $1 AND business_id = $2 AND NOT deleted', [branchId, businessId])).rows[0];
  if (!b) throw new HttpError(400, 'Choose a branch that exists');
  return b.id;
}

// Names only, so every staff phone can show who recorded what (works for all roles)
router.get('/staff', async (req, res) => {
  const { rows } = await query('SELECT id, name, role, branch_id FROM employees WHERE business_id = $1 ORDER BY name', [req.business.id]);
  res.json({ staff: rows.map((r) => ({ id: r.id, name: r.name, role: r.role, branchId: r.branch_id })) });
});

router.get('/employees', requireOwner, async (req, res) => {
  const { rows } = await query('SELECT * FROM employees WHERE business_id = $1 ORDER BY is_active DESC, name', [req.business.id]);
  const limits = await getLimits({ query }, req.business);
  res.json({ employees: rows.map(shape), limits });
});

router.post('/employees', requireOwner, requireActiveSubscription, async (req, res) => {
  const { name, phone, pin, role = 'cashier', branchId } = req.body || {};
  const normalized = normalizePhone(phone);
  if (!name || !String(name).trim()) throw new HttpError(400, 'Enter the employee name');
  if (!normalized) throw new HttpError(400, 'Enter a valid Safaricom number for the employee');
  if (!/^\d{4,6}$/.test(String(pin || ''))) throw new HttpError(400, 'PIN must be 4 to 6 digits');
  if (!['manager', 'cashier'].includes(role)) throw new HttpError(400, 'Role must be manager or cashier');
  const branch = await checkBranch(req.business.id, branchId);
  if (role === 'cashier' && !branch) throw new HttpError(400, 'Choose the branch this cashier works at');

  const limits = await getLimits({ query }, req.business);
  const count = Number((await query('SELECT count(*) FROM employees WHERE business_id = $1 AND is_active', [req.business.id])).rows[0].count);
  if (count >= limits.maxEmployees) {
    throw new HttpError(403, `Your plan allows ${limits.maxEmployees} staff accounts. Upgrade to add more.`, 'LIMIT_EMPLOYEES');
  }
  const taken = await query('SELECT 1 FROM businesses WHERE phone = $1 UNION ALL SELECT 1 FROM employees WHERE phone = $1', [normalized]);
  if (taken.rows[0]) throw new HttpError(409, 'That phone number is already used by another account');

  const { rows } = await query(
    `INSERT INTO employees (business_id, branch_id, name, phone, pin_hash, role)
     VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
    [req.business.id, branch, String(name).trim(), normalized, await bcrypt.hash(String(pin), 10), role]
  );
  res.status(201).json({ employee: shape(rows[0]) });
});

// Body: any of { name, role, branchId, isActive, pin }
router.patch('/employees/:id', requireOwner, async (req, res) => {
  const e = (await query('SELECT * FROM employees WHERE id = $1 AND business_id = $2', [req.params.id, req.business.id])).rows[0];
  if (!e) throw new HttpError(404, 'Employee not found');
  const { name, role, branchId, isActive, pin } = req.body || {};

  const next = {
    name: name !== undefined ? String(name).trim() || e.name : e.name,
    role: role !== undefined ? role : e.role,
    branch: branchId !== undefined ? await checkBranch(req.business.id, branchId) : e.branch_id,
    active: isActive !== undefined ? Boolean(isActive) : e.is_active,
    pinHash: e.pin_hash,
  };
  if (!['manager', 'cashier'].includes(next.role)) throw new HttpError(400, 'Role must be manager or cashier');
  if (next.role === 'cashier' && !next.branch) throw new HttpError(400, 'A cashier must be assigned to a branch');
  if (pin !== undefined) {
    if (!/^\d{4,6}$/.test(String(pin))) throw new HttpError(400, 'PIN must be 4 to 6 digits');
    next.pinHash = await bcrypt.hash(String(pin), 10);
  }
  if (next.active && !e.is_active) {
    const limits = await getLimits({ query }, req.business);
    const count = Number((await query('SELECT count(*) FROM employees WHERE business_id = $1 AND is_active', [req.business.id])).rows[0].count);
    if (count >= limits.maxEmployees) throw new HttpError(403, `Your plan allows ${limits.maxEmployees} staff accounts.`, 'LIMIT_EMPLOYEES');
  }

  const { rows } = await query(
    `UPDATE employees SET name = $2, role = $3, branch_id = $4, is_active = $5, pin_hash = $6
      WHERE id = $1 RETURNING *`,
    [e.id, next.name, next.role, next.branch, next.active, next.pinHash]
  );
  res.json({ employee: shape(rows[0]) });
});

module.exports = router;
