import { getDb } from './database';
import { addDays, startOfDay } from '../utils/format';

// branchId null = all branches. Returns [sqlFragment, params] for the given table alias.
function branchClause(branchId, alias = '') {
  return branchId ? [` AND ${alias}branch_id = ?`, [branchId]] : ['', []];
}

export async function daySummary(dayStart, branchId = null) {
  const db = await getDb();
  const end = addDays(dayStart, 1);
  const [bc, bp] = branchClause(branchId);
  const sales = await db.getAllAsync(
    `SELECT method, COALESCE(sum(amount), 0) AS total, count(*) AS n FROM sales
      WHERE deleted = 0 AND occurred_at >= ? AND occurred_at < ?${bc} GROUP BY method`,
    [dayStart, end, ...bp]
  );
  const exp = await db.getFirstAsync(
    `SELECT COALESCE(sum(amount), 0) AS total, count(*) AS n FROM expenses
      WHERE deleted = 0 AND occurred_at >= ? AND occurred_at < ?${bc}`,
    [dayStart, end, ...bp]
  );
  const collected = await db.getFirstAsync(
    `SELECT COALESCE(sum(amount), 0) AS total FROM debt_entries
      WHERE deleted = 0 AND type = 'payment' AND occurred_at >= ? AND occurred_at < ?${bc}`,
    [dayStart, end, ...bp]
  );
  const byMethod = { cash: 0, mpesa: 0, other: 0 };
  let salesTotal = 0;
  let salesCount = 0;
  for (const s of sales) {
    byMethod[s.method] = (byMethod[s.method] || 0) + s.total;
    salesTotal += s.total;
    salesCount += s.n;
  }
  return {
    salesTotal,
    salesCount,
    byMethod,
    expensesTotal: exp.total,
    expensesCount: exp.n,
    profit: salesTotal - exp.total,
    debtCollected: collected.total,
    outstanding: await totalOutstanding(branchId),
  };
}

// Sales per staff member for a day. created_by NULL means the owner recorded it.
export async function salesByStaff(dayStart, branchId = null) {
  const db = await getDb();
  const [bc, bp] = branchClause(branchId);
  return db.getAllAsync(
    `SELECT created_by, COALESCE(sum(amount), 0) AS total, count(*) AS n FROM sales
      WHERE deleted = 0 AND occurred_at >= ? AND occurred_at < ?${bc}
      GROUP BY created_by ORDER BY total DESC`,
    [dayStart, addDays(dayStart, 1), ...bp]
  );
}

// Profit per branch for a day, for owners comparing locations
export async function dayByBranch(dayStart) {
  const db = await getDb();
  const end = addDays(dayStart, 1);
  return db.getAllAsync(
    `SELECT b.id, b.name,
            COALESCE((SELECT sum(amount) FROM sales s WHERE s.branch_id = b.id AND s.deleted = 0 AND s.occurred_at >= ? AND s.occurred_at < ?), 0) AS sales,
            COALESCE((SELECT sum(amount) FROM expenses e WHERE e.branch_id = b.id AND e.deleted = 0 AND e.occurred_at >= ? AND e.occurred_at < ?), 0) AS expenses
       FROM branches b WHERE b.deleted = 0 ORDER BY b.created_at`,
    [dayStart, end, dayStart, end]
  );
}

export async function lastNDays(n = 7, branchId = null) {
  const db = await getDb();
  const today = startOfDay();
  const start = addDays(today, -(n - 1));
  const [bc, bp] = branchClause(branchId);
  const sales = await db.getAllAsync(
    `SELECT occurred_at, amount FROM sales WHERE deleted = 0 AND occurred_at >= ?${bc}`, [start, ...bp]
  );
  const exps = await db.getAllAsync(
    `SELECT occurred_at, amount FROM expenses WHERE deleted = 0 AND occurred_at >= ?${bc}`, [start, ...bp]
  );
  const days = [];
  for (let i = 0; i < n; i++) days.push({ day: addDays(start, i), sales: 0, expenses: 0 });
  const idx = (ts) => days.findIndex((d) => ts >= d.day && ts < addDays(d.day, 1));
  sales.forEach((s) => { const i = idx(s.occurred_at); if (i >= 0) days[i].sales += s.amount; });
  exps.forEach((e) => { const i = idx(e.occurred_at); if (i >= 0) days[i].expenses += e.amount; });
  return days;
}

export async function listEntries(table, dayStart, branchId = null) {
  const db = await getDb();
  const [bc, bp] = branchClause(branchId);
  return db.getAllAsync(
    `SELECT * FROM ${table} WHERE deleted = 0 AND occurred_at >= ? AND occurred_at < ?${bc} ORDER BY occurred_at DESC`,
    [dayStart, addDays(dayStart, 1), ...bp]
  );
}

const BALANCE_SQL = `COALESCE((SELECT sum(CASE WHEN d.type = 'credit' THEN d.amount ELSE -d.amount END)
  FROM debt_entries d WHERE d.customer_id = c.id AND d.deleted = 0), 0)`;

export async function customersWithBalance(search = '', branchId = null) {
  const db = await getDb();
  const [bc, bp] = branchClause(branchId, 'c.');
  return db.getAllAsync(
    `SELECT c.*, ${BALANCE_SQL} AS balance,
            (SELECT max(occurred_at) FROM debt_entries d WHERE d.customer_id = c.id AND d.deleted = 0) AS last_activity
       FROM customers c
      WHERE c.deleted = 0 AND (c.name LIKE ? OR COALESCE(c.phone, '') LIKE ?)${bc}
      ORDER BY balance DESC, c.name`,
    [`%${search}%`, `%${search}%`, ...bp]
  );
}

export async function getCustomer(id) {
  const db = await getDb();
  return db.getFirstAsync(`SELECT c.*, ${BALANCE_SQL} AS balance FROM customers c WHERE c.id = ?`, [id]);
}

export async function customerEntries(customerId) {
  const db = await getDb();
  return db.getAllAsync(
    'SELECT * FROM debt_entries WHERE customer_id = ? AND deleted = 0 ORDER BY occurred_at DESC',
    [customerId]
  );
}

export async function totalOutstanding(branchId = null) {
  const db = await getDb();
  const [bc, bp] = branchClause(branchId, 'd.');
  const r = await db.getFirstAsync(
    `SELECT COALESCE(sum(CASE WHEN type = 'credit' THEN amount ELSE -amount END), 0) AS total
       FROM debt_entries d WHERE deleted = 0
        AND customer_id IN (SELECT id FROM customers WHERE deleted = 0)${bc}`,
    bp
  );
  return r.total;
}

export async function branchRecordCount(branchId) {
  const db = await getDb();
  let n = 0;
  for (const t of ['sales', 'expenses', 'customers', 'debt_entries']) {
    const r = await db.getFirstAsync(`SELECT count(*) AS n FROM ${t} WHERE branch_id = ? AND deleted = 0`, [branchId]);
    n += r.n;
  }
  return n;
}
