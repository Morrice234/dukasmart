import * as SQLite from 'expo-sqlite';
import * as Crypto from 'expo-crypto';
import { emit } from '../events';

// Fields per synced table, must match the server's sync route. Branches first.
export const SYNC_TABLES = {
  branches: ['name', 'location'],
  products: ['name', 'unit', 'buy_price', 'sell_price', 'reorder_level', 'created_by'],
  customers: ['name', 'phone', 'notes', 'branch_id', 'created_by'],
  sales: ['amount', 'method', 'description', 'customer_id', 'occurred_at', 'branch_id', 'created_by'],
  expenses: ['amount', 'method', 'category', 'description', 'occurred_at', 'branch_id', 'created_by'],
  debt_entries: ['customer_id', 'type', 'amount', 'note', 'occurred_at', 'branch_id', 'created_by'],
  stock_movements: ['product_id', 'type', 'quantity', 'unit_cost', 'sale_id', 'expense_id', 'note', 'occurred_at', 'branch_id', 'created_by'],
};

// Columns that come from the server as text (Postgres NUMERIC) but must be stored as numbers
export const NUMERIC_COLUMNS = ['amount', 'quantity', 'unit_cost', 'buy_price', 'sell_price', 'reorder_level'];

const BASE_COLS = 'id TEXT PRIMARY KEY NOT NULL, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL, deleted INTEGER NOT NULL DEFAULT 0, dirty INTEGER NOT NULL DEFAULT 1';

// Each entry upgrades the local database by one version (PRAGMA user_version)
const MIGRATIONS = [
  // v1: first release
  `CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY NOT NULL, value TEXT);
   CREATE TABLE IF NOT EXISTS customers (${BASE_COLS}, name TEXT NOT NULL, phone TEXT, notes TEXT);
   CREATE TABLE IF NOT EXISTS sales (${BASE_COLS}, amount REAL NOT NULL, method TEXT NOT NULL DEFAULT 'cash', description TEXT, customer_id TEXT, occurred_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS expenses (${BASE_COLS}, amount REAL NOT NULL, method TEXT NOT NULL DEFAULT 'cash', category TEXT, description TEXT, occurred_at INTEGER NOT NULL);
   CREATE TABLE IF NOT EXISTS debt_entries (${BASE_COLS}, customer_id TEXT NOT NULL, type TEXT NOT NULL, amount REAL NOT NULL, note TEXT, occurred_at INTEGER NOT NULL);
   CREATE INDEX IF NOT EXISTS sales_day ON sales (occurred_at);
   CREATE INDEX IF NOT EXISTS expenses_day ON expenses (occurred_at);
   CREATE INDEX IF NOT EXISTS debt_customer ON debt_entries (customer_id);`,
  // v2: branches and staff attribution
  `CREATE TABLE IF NOT EXISTS branches (${BASE_COLS}, name TEXT NOT NULL, location TEXT);
   ALTER TABLE customers ADD COLUMN branch_id TEXT;
   ALTER TABLE customers ADD COLUMN created_by TEXT;
   ALTER TABLE sales ADD COLUMN branch_id TEXT;
   ALTER TABLE sales ADD COLUMN created_by TEXT;
   ALTER TABLE expenses ADD COLUMN branch_id TEXT;
   ALTER TABLE expenses ADD COLUMN created_by TEXT;
   ALTER TABLE debt_entries ADD COLUMN branch_id TEXT;
   ALTER TABLE debt_entries ADD COLUMN created_by TEXT;
   CREATE INDEX IF NOT EXISTS sales_branch_day ON sales (branch_id, occurred_at);
   CREATE INDEX IF NOT EXISTS expenses_branch_day ON expenses (branch_id, occurred_at);`,
  // v3: stock
  `CREATE TABLE IF NOT EXISTS products (${BASE_COLS}, name TEXT NOT NULL, unit TEXT NOT NULL DEFAULT 'pcs', buy_price REAL, sell_price REAL, reorder_level REAL, created_by TEXT);
   CREATE TABLE IF NOT EXISTS stock_movements (${BASE_COLS}, product_id TEXT NOT NULL, type TEXT NOT NULL, quantity REAL NOT NULL, unit_cost REAL, sale_id TEXT, expense_id TEXT, note TEXT, occurred_at INTEGER NOT NULL, branch_id TEXT, created_by TEXT);
   CREATE INDEX IF NOT EXISTS stock_product_branch ON stock_movements (product_id, branch_id);
   CREATE INDEX IF NOT EXISTS stock_sale ON stock_movements (sale_id);`,
];

let dbPromise = null;

async function migrate(db) {
  await db.execAsync('PRAGMA journal_mode = WAL;');
  const { user_version: current } = await db.getFirstAsync('PRAGMA user_version');
  for (let v = current; v < MIGRATIONS.length; v++) {
    await db.withTransactionAsync(async () => {
      await db.execAsync(MIGRATIONS[v]);
      await db.execAsync(`PRAGMA user_version = ${v + 1}`);
    });
  }
}

export function getDb() {
  if (!dbPromise) {
    dbPromise = (async () => {
      const db = await SQLite.openDatabaseAsync('dukasmart.db');
      await migrate(db);
      return db;
    })();
  }
  return dbPromise;
}

export function columnsFor(table) {
  return ['id', ...SYNC_TABLES[table], 'created_at', 'updated_at', 'deleted', 'dirty'];
}

// Who is using this phone, so new records are stamped with the right staff member
let session = { employeeId: null };
export function setSessionContext(ctx) {
  session = { ...session, ...ctx };
}

// Create or update a record locally. It is marked dirty so the sync engine pushes it.
export async function saveRecord(table, data) {
  const db = await getDb();
  const now = Date.now();
  const id = data.id || Crypto.randomUUID();
  const existing = data.id ? await db.getFirstAsync(`SELECT * FROM ${table} WHERE id = ?`, [id]) : null;
  const row = {
    ...(existing || {}),
    ...data,
    id,
    created_at: existing ? existing.created_at : now,
    // Never move backwards in time if the phone clock was changed
    updated_at: existing ? Math.max(now, existing.updated_at + 1) : now,
    deleted: data.deleted ? 1 : 0,
    dirty: 1,
  };
  if (!existing && SYNC_TABLES[table].includes('created_by')) row.created_by = session.employeeId;
  const cols = columnsFor(table);
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => (row[c] === undefined ? null : row[c]))
  );
  emit('data');
  emit('local-write');
  return row;
}

export async function deleteRecord(table, id) {
  return saveRecord(table, { id, deleted: true });
}

export async function getMeta(key) {
  const db = await getDb();
  const row = await db.getFirstAsync('SELECT value FROM meta WHERE key = ?', [key]);
  return row ? row.value : null;
}

export async function setMeta(key, value) {
  const db = await getDb();
  if (value === null || value === undefined) await db.runAsync('DELETE FROM meta WHERE key = ?', [key]);
  else await db.runAsync('INSERT OR REPLACE INTO meta (key, value) VALUES (?, ?)', [key, String(value)]);
}

export async function pendingChangesCount() {
  const db = await getDb();
  let total = 0;
  for (const t of Object.keys(SYNC_TABLES)) {
    const r = await db.getFirstAsync(`SELECT count(*) AS n FROM ${t} WHERE dirty = 1`);
    total += r.n;
  }
  return total;
}

// Used when a different person signs in on this phone
export async function wipeLocalData() {
  const db = await getDb();
  for (const t of Object.keys(SYNC_TABLES)) await db.runAsync(`DELETE FROM ${t}`);
  await db.runAsync('DELETE FROM meta');
  emit('data');
}

// Drops rows the server refused (permission or plan limit) and forces a fresh download
export async function discardRejected(rejected) {
  const db = await getDb();
  let n = 0;
  for (const [table, ids] of Object.entries(rejected || {})) {
    if (!SYNC_TABLES[table]) continue;
    for (const id of ids) {
      await db.runAsync(`DELETE FROM ${table} WHERE id = ?`, [id]);
      n += 1;
    }
  }
  if (n) await setMeta('sync_cursor', 0);
  return n;
}
