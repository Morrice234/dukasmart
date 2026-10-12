const express = require('express');
const { query, transaction } = require('../db');
const { HttpError } = require('../utils');
const { requireUser, requireActiveSubscription } = require('../middleware/auth');
const { getLimits } = require('../services/limits');

const router = express.Router();

// Columns the phone may send per table (besides id, created_at, updated_at, deleted).
// Branches and products go first so records that point at them arrive after them.
const TABLES = {
  branches: ['name', 'location'],
  products: ['name', 'unit', 'buy_price', 'sell_price', 'reorder_level'],
  customers: ['name', 'phone', 'notes', 'branch_id'],
  sales: ['amount', 'method', 'description', 'customer_id', 'occurred_at', 'branch_id'],
  expenses: ['amount', 'method', 'category', 'description', 'occurred_at', 'branch_id'],
  debt_entries: ['customer_id', 'type', 'amount', 'note', 'occurred_at', 'branch_id'],
  stock_movements: ['product_id', 'type', 'quantity', 'unit_cost', 'sale_id', 'expense_id', 'note', 'occurred_at', 'branch_id'],
};
// Shared by every branch of the business, so they are never filtered by branch
const BUSINESS_WIDE = new Set(['branches', 'products']);
const DATA_TABLES = Object.keys(TABLES).filter((t) => !BUSINESS_WIDE.has(t));
const MOVEMENT_TYPES = new Set(['in', 'sale', 'out', 'adjust']);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const MAX_ROWS_PER_PUSH = 2000;

function upsertSql(table) {
  const fields = TABLES[table];
  const extra = table === 'branches' ? [] : ['created_by'];
  const cols = ['id', 'business_id', ...fields, ...extra, 'created_at', 'updated_at', 'deleted'];
  const updateCols = [...fields, 'updated_at', 'deleted'];
  const sql = `
    INSERT INTO ${table} (${cols.join(', ')})
    VALUES (${cols.map((_, i) => `$${i + 1}`).join(', ')})
    ON CONFLICT (id) DO UPDATE SET
      ${updateCols.map((c) => `${c} = EXCLUDED.${c}`).join(', ')},
      version = nextval('sync_version_seq')
    WHERE ${table}.business_id = EXCLUDED.business_id
      AND ${table}.updated_at < EXCLUDED.updated_at`;
  return { cols, sql };
}

// POST /api/sync/push  { changes: { sales: [row, ...], ... } }
// Last write wins by client updated_at. Rows the user may not write come back in `rejected`.
router.post('/push', requireUser, requireActiveSubscription, async (req, res) => {
  const changes = (req.body && req.body.changes) || {};
  const total = Object.values(changes).reduce((n, rows) => n + (Array.isArray(rows) ? rows.length : 0), 0);
  if (total > MAX_ROWS_PER_PUSH) throw new HttpError(413, 'Too many changes in one push');

  const bid = req.business.id;
  const employee = req.employee;
  const scopeBranch = employee ? employee.branch_id : null; // null = every branch
  const accepted = {};
  const rejected = {};

  await transaction(async (client) => {
    const branchRows = (await client.query('SELECT id, deleted FROM branches WHERE business_id = $1 ORDER BY created_at', [bid])).rows;
    const branchIds = new Set(branchRows.map((b) => b.id));
    const mainBranch = (branchRows.find((b) => !b.deleted) || branchRows[0] || {}).id;
    let liveBranches = branchRows.filter((b) => !b.deleted).length;
    const limits = await getLimits(client, req.business);

    for (const table of Object.keys(TABLES)) {
      const rows = Array.isArray(changes[table]) ? changes[table] : [];
      accepted[table] = [];
      rejected[table] = [];
      if (!rows.length) continue;
      const { cols, sql } = upsertSql(table);

      for (const row of rows) {
        if (!row || !UUID_RE.test(String(row.id))) continue;
        const reject = () => rejected[table].push(row.id);

        const existing = (await client.query(`SELECT * FROM ${table} WHERE id = $1`, [row.id])).rows[0];
        if (existing && existing.business_id !== bid) { reject(); continue; }

        if (table === 'branches') {
          if (req.role !== 'owner') { reject(); continue; }
          if (!existing && !row.deleted) {
            if (liveBranches >= limits.maxBranches) { reject(); continue; }
            liveBranches += 1;
          }
          branchIds.add(row.id);
        } else if (table === 'products') {
          if (!row.name || !String(row.name).trim()) { reject(); continue; }
          if (req.role === 'cashier') {
            // Cashiers can add a product they receive, and fix their own, but cannot change or delete others
            if (row.deleted && !(existing && existing.deleted)) { reject(); continue; }
            if (existing && existing.created_by !== employee.id) { reject(); continue; }
          }
        } else {
          if (table === 'stock_movements' && (!MOVEMENT_TYPES.has(row.type) || !Number.isFinite(Number(row.quantity)))) { reject(); continue; }
          if (!row.branch_id) row.branch_id = scopeBranch || mainBranch;
          if (!branchIds.has(row.branch_id)) { reject(); continue; }
          if (scopeBranch && (row.branch_id !== scopeBranch || (existing && existing.branch_id !== scopeBranch))) { reject(); continue; }
          if (req.role === 'cashier') {
            // Cashiers can add records and fix their own, but cannot delete
            if (row.deleted && !(existing && existing.deleted)) { reject(); continue; }
            if (existing && existing.created_by !== employee.id) { reject(); continue; }
          }
          if (row.customer_id === '') row.customer_id = null;
        }

        const values = cols.map((c) => {
          if (c === 'business_id') return bid;
          if (c === 'created_by') return employee ? employee.id : null;
          if (c === 'deleted') return Boolean(row.deleted);
          if (c === 'created_at' || c === 'updated_at') return Number(row[c]) || Date.now();
          return row[c] === undefined ? null : row[c];
        });
        await client.query(sql, values);
        accepted[table].push(row.id);
      }
    }
    await client.query('UPDATE businesses SET last_sync_at = now() WHERE id = $1', [bid]);
  });

  res.json({ accepted, rejected });
});

// GET /api/sync/pull?since=<version>&limit=500
// Returns rows changed after `since`, oldest first. Branch-bound staff only see their branch.
router.get('/pull', requireUser, async (req, res) => {
  const since = Number(req.query.since) || 0;
  const limit = Math.min(Number(req.query.limit) || 500, 1000);
  const bid = req.business.id;
  const scopeBranch = req.employee ? req.employee.branch_id : null;
  const params = [bid, since, limit];
  if (scopeBranch) params.push(scopeBranch);

  const parts = Object.keys(TABLES).map((t) => {
    let scope = '';
    if (scopeBranch && t === 'branches') scope = ' AND id = $4';
    else if (scopeBranch && !BUSINESS_WIDE.has(t)) scope = ' AND branch_id = $4';
    return `SELECT '${t}' AS tbl, version, to_jsonb(${t}) AS row FROM ${t} WHERE business_id = $1 AND version > $2${scope}`;
  });
  const { rows } = await query(`${parts.join(' UNION ALL ')} ORDER BY version LIMIT $3`, params);

  const changes = rows.map((r) => ({ table: r.tbl, row: r.row }));
  const cursor = rows.length ? Number(rows[rows.length - 1].version) : since;
  await query('UPDATE businesses SET last_sync_at = now() WHERE id = $1', [bid]);
  res.json({ changes, cursor, hasMore: rows.length === limit });
});

module.exports = router;
module.exports.DATA_TABLES = DATA_TABLES;
