import * as FileSystem from 'expo-file-system/legacy';
import * as Sharing from 'expo-sharing';
import { getDb } from '../db/database';

// What can be exported. "dated" ones use the chosen period; the others are a snapshot of today.
export const EXPORTS = {
  sales: { label: 'Sales', dated: true },
  expenses: { label: 'Expenses', dated: true },
  deni: { label: 'Deni balances', dated: false },
  deni_history: { label: 'Deni history', dated: true },
  stock: { label: 'Stock on hand', dated: false },
  stock_movements: { label: 'Stock movements', dated: true },
};

export const PERIODS = {
  this_month: 'This month',
  last_month: 'Last month',
  last_3_months: 'Last 3 months',
  this_year: 'This year',
  all: 'All time',
};

export function periodRange(key, now = new Date()) {
  const y = now.getFullYear();
  const m = now.getMonth();
  switch (key) {
    case 'this_month': return [new Date(y, m, 1).getTime(), Date.now() + 1];
    case 'last_month': return [new Date(y, m - 1, 1).getTime(), new Date(y, m, 1).getTime()];
    case 'last_3_months': return [new Date(y, m - 2, 1).getTime(), Date.now() + 1];
    case 'this_year': return [new Date(y, 0, 1).getTime(), Date.now() + 1];
    default: return [0, Date.now() + 1];
  }
}

const pad = (n) => String(n).padStart(2, '0');
function stamp(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
const num = (n) => (n === null || n === undefined || n === '' ? '' : Math.round(Number(n) * 1000) / 1000);
const METHOD = { cash: 'Cash', mpesa: 'M-Pesa', credit: 'Deni', bank: 'Bank' };
const MOVE = { in: 'Received', sale: 'Sold', out: 'Removed', adjust: 'Count correction' };

// Quotes every value that needs it, so commas and line breaks in notes do not break columns
function toCsv(header, rows) {
  const cell = (v) => {
    let s = v === null || v === undefined ? '' : String(v);
    // Text typed into a note like "=SUM(...)" must not run as a formula when opened in Excel
    if (typeof v === 'string' && /^[=+@]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  // The BOM tells Excel the file is UTF-8, so names with accents or emojis show correctly
  return '﻿' + [header, ...rows].map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';
}

function branchSql(branchId, alias) {
  return branchId ? [` AND ${alias}.branch_id = ?`, [branchId]] : ['', []];
}

// names: { branch(id), staff(id) } turn ids into readable names
async function rowsFor(kind, { branchId, from, to, names }) {
  const db = await getDb();
  const B = (id) => names.branch(id);
  const S = (id) => names.staff(id);

  if (kind === 'sales') {
    const [bc, bp] = branchSql(branchId, 's');
    const rows = await db.getAllAsync(
      `SELECT s.*, c.name AS customer_name FROM sales s LEFT JOIN customers c ON c.id = s.customer_id
        WHERE s.deleted = 0 AND s.occurred_at >= ? AND s.occurred_at < ?${bc} ORDER BY s.occurred_at`,
      [from, to, ...bp]
    );
    return [['Date', 'Amount (KSh)', 'Paid by', 'Description', 'Customer', 'Branch', 'Recorded by'],
      rows.map((r) => [stamp(r.occurred_at), num(r.amount), METHOD[r.method] || r.method || '', r.description || '', r.customer_name || '', B(r.branch_id), S(r.created_by)])];
  }

  if (kind === 'expenses') {
    const [bc, bp] = branchSql(branchId, 'e');
    const rows = await db.getAllAsync(
      `SELECT e.* FROM expenses e WHERE e.deleted = 0 AND e.occurred_at >= ? AND e.occurred_at < ?${bc} ORDER BY e.occurred_at`,
      [from, to, ...bp]
    );
    return [['Date', 'Amount (KSh)', 'Category', 'Description', 'Paid by', 'Branch', 'Recorded by'],
      rows.map((r) => [stamp(r.occurred_at), num(r.amount), r.category || '', r.description || '', METHOD[r.method] || r.method || '', B(r.branch_id), S(r.created_by)])];
  }

  if (kind === 'deni') {
    const [bc, bp] = branchSql(branchId, 'c');
    const rows = await db.getAllAsync(
      `SELECT c.*,
              COALESCE((SELECT sum(CASE WHEN d.type = 'credit' THEN d.amount ELSE 0 END) FROM debt_entries d WHERE d.customer_id = c.id AND d.deleted = 0), 0) AS taken,
              COALESCE((SELECT sum(CASE WHEN d.type = 'payment' THEN d.amount ELSE 0 END) FROM debt_entries d WHERE d.customer_id = c.id AND d.deleted = 0), 0) AS paid,
              (SELECT max(occurred_at) FROM debt_entries d WHERE d.customer_id = c.id AND d.deleted = 0) AS last_activity
         FROM customers c WHERE c.deleted = 0${bc} ORDER BY c.name COLLATE NOCASE`,
      bp
    );
    return [['Customer', 'Phone', 'Total taken (KSh)', 'Total paid (KSh)', 'Balance owed (KSh)', 'Last activity', 'Branch', 'Notes'],
      rows.map((r) => [r.name, r.phone || '', num(r.taken), num(r.paid), num(r.taken - r.paid), stamp(r.last_activity), B(r.branch_id), r.notes || ''])];
  }

  if (kind === 'deni_history') {
    const [bc, bp] = branchSql(branchId, 'd');
    const rows = await db.getAllAsync(
      `SELECT d.*, c.name AS customer_name, c.phone AS customer_phone FROM debt_entries d LEFT JOIN customers c ON c.id = d.customer_id
        WHERE d.deleted = 0 AND d.occurred_at >= ? AND d.occurred_at < ?${bc} ORDER BY d.occurred_at`,
      [from, to, ...bp]
    );
    return [['Date', 'Customer', 'Phone', 'Type', 'Amount (KSh)', 'Note', 'Branch', 'Recorded by'],
      rows.map((r) => [stamp(r.occurred_at), r.customer_name || '', r.customer_phone || '', r.type === 'credit' ? 'Took on credit' : 'Paid', num(r.amount), r.note || '', B(r.branch_id), S(r.created_by)])];
  }

  if (kind === 'stock') {
    const qty = branchId
      ? 'COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.deleted = 0 AND m.branch_id = ?), 0)'
      : 'COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.deleted = 0), 0)';
    const rows = await db.getAllAsync(
      `SELECT p.*, ${qty} AS qty FROM products p WHERE p.deleted = 0 ORDER BY p.name COLLATE NOCASE`,
      branchId ? [branchId] : []
    );
    return [['Product', 'Unit', 'Quantity', 'Buying price (KSh)', 'Selling price (KSh)', 'Stock value at buying price (KSh)', 'Reorder level'],
      rows.map((r) => [r.name, r.unit || '', num(r.qty), num(r.buy_price), num(r.sell_price),
        r.buy_price ? num(r.qty * r.buy_price) : '', num(r.reorder_level)])];
  }

  if (kind === 'stock_movements') {
    const [bc, bp] = branchSql(branchId, 'm');
    const rows = await db.getAllAsync(
      `SELECT m.*, p.name AS product_name, p.unit FROM stock_movements m LEFT JOIN products p ON p.id = m.product_id
        WHERE m.deleted = 0 AND m.occurred_at >= ? AND m.occurred_at < ?${bc} ORDER BY m.occurred_at`,
      [from, to, ...bp]
    );
    return [['Date', 'Product', 'Change', 'Quantity', 'Unit', 'Unit cost (KSh)', 'Note', 'Branch', 'Recorded by'],
      rows.map((r) => [stamp(r.occurred_at), r.product_name || '', MOVE[r.type] || r.type, num(r.quantity), r.unit || '', num(r.unit_cost), r.note || '', B(r.branch_id), S(r.created_by)])];
  }

  throw new Error('Unknown export');
}

function safeName(s) {
  return String(s || 'shop').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 30) || 'shop';
}

// Builds the CSV and opens the share menu (WhatsApp, Gmail, Drive, save to Files...)
// Returns the number of rows exported.
export async function exportCsv(kind, { period, branchId, businessName, names }) {
  const def = EXPORTS[kind];
  const [from, to] = def.dated ? periodRange(period) : [0, Date.now() + 1];
  const [header, rows] = await rowsFor(kind, { branchId, from, to, names });

  const today = new Date();
  const fileName = `${safeName(businessName)}-${kind.replace('_', '-')}-${today.getFullYear()}${pad(today.getMonth() + 1)}${pad(today.getDate())}.csv`;
  const uri = FileSystem.cacheDirectory + fileName;
  await FileSystem.writeAsStringAsync(uri, toCsv(header, rows), { encoding: FileSystem.EncodingType.UTF8 });

  if (!(await Sharing.isAvailableAsync())) throw new Error('Sharing is not available on this phone');
  await Sharing.shareAsync(uri, { mimeType: 'text/csv', dialogTitle: `${def.label} (${rows.length} rows)`, UTI: 'public.comma-separated-values-text' });
  return rows.length;
}
