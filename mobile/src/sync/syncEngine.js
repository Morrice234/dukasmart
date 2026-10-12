import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';
import { api, hasToken } from '../api/client';
import { getDb, getMeta, setMeta, SYNC_TABLES, NUMERIC_COLUMNS, columnsFor, pendingChangesCount, discardRejected } from '../db/database';
import { emit, on } from '../events';

const PUSH_BATCH = 200;
const PULL_LIMIT = 500;
// Background check for changes from other phones. New records upload within seconds anyway,
// so this only needs to be occasional; it keeps data use and free-hosting limits low.
const INTERVAL_MS = 5 * 60 * 1000;

let running = false;
let again = false;
let state = { status: 'idle', lastSyncedAt: null, error: null, pending: 0 };

function setState(patch) {
  state = { ...state, ...patch };
  emit('sync-state', state);
}

export function getSyncState() {
  return state;
}

async function push() {
  const db = await getDb();
  for (let round = 0; round < 50; round++) {
    const changes = {};
    let count = 0;
    for (const table of Object.keys(SYNC_TABLES)) {
      const rows = await db.getAllAsync(`SELECT * FROM ${table} WHERE dirty = 1 LIMIT ${PUSH_BATCH}`);
      if (rows.length) {
        changes[table] = rows.map(({ dirty, ...r }) => ({ ...r, deleted: Boolean(r.deleted) }));
        count += rows.length;
      }
    }
    if (!count) return;

    const res = await api('/sync/push', { method: 'POST', body: { changes }, timeout: 45000 });

    // Only clear the dirty flag if the row was not edited again while we were pushing
    for (const [table, rows] of Object.entries(changes)) {
      const ok = new Set((res.accepted && res.accepted[table]) || []);
      for (const r of rows) {
        if (!ok.has(r.id)) continue;
        await db.runAsync(`UPDATE ${table} SET dirty = 0 WHERE id = ? AND updated_at = ?`, [r.id, r.updated_at]);
      }
    }

    // Rows the server refused (no permission, or over the plan's branch limit)
    const dropped = await discardRejected(res.rejected);
    if (dropped) {
      emit('sync-rejected', dropped);
      emit('data');
    }
  }
}

async function applyRemote(db, table, remote) {
  if (!SYNC_TABLES[table]) return;
  const local = await db.getFirstAsync(`SELECT updated_at, dirty FROM ${table} WHERE id = ?`, [remote.id]);
  // Local unsynced edit is newer: keep it, it will be pushed next round
  if (local && local.dirty && local.updated_at > Number(remote.updated_at)) return;
  const cols = columnsFor(table);
  const row = { ...remote, deleted: remote.deleted ? 1 : 0, dirty: 0 };
  NUMERIC_COLUMNS.forEach((k) => { if (row[k] !== undefined && row[k] !== null) row[k] = Number(row[k]); });
  await db.runAsync(
    `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${cols.map(() => '?').join(', ')})`,
    cols.map((c) => (row[c] === undefined ? null : row[c]))
  );
}

async function pull() {
  const db = await getDb();
  let cursor = Number((await getMeta('sync_cursor')) || 0);
  let changed = false;
  for (let round = 0; round < 200; round++) {
    const res = await api(`/sync/pull?since=${cursor}&limit=${PULL_LIMIT}`, { timeout: 45000 });
    if (res.changes.length) {
      await db.withTransactionAsync(async () => {
        for (const { table, row } of res.changes) await applyRemote(db, table, row);
      });
      changed = true;
    }
    cursor = res.cursor;
    await setMeta('sync_cursor', cursor);
    if (!res.hasMore) break;
  }
  if (changed) emit('data');
}

export async function syncNow() {
  if (!hasToken()) return;
  if (running) { again = true; return; }

  const net = await NetInfo.fetch();
  if (!net.isConnected || net.isInternetReachable === false) {
    setState({ status: 'offline', pending: await pendingChangesCount() });
    return;
  }

  running = true;
  setState({ status: 'syncing', error: null });
  let blocked = false;
  try {
    try {
      await push();
    } catch (e) {
      if (e.status === 402) blocked = true; // subscription ended, keep data on the phone
      else throw e;
    }
    await pull();
    const now = Date.now();
    await setMeta('last_synced_at', now);
    setState({ status: blocked ? 'blocked' : 'idle', lastSyncedAt: now, pending: await pendingChangesCount() });
    if (blocked) emit('subscription-blocked');
  } catch (e) {
    setState({ status: e.status === 0 ? 'offline' : 'error', error: e.message, pending: await pendingChangesCount() });
    if (e.status === 401) emit('auth-expired');
  } finally {
    running = false;
    if (again) { again = false; setTimeout(syncNow, 500); }
  }
}

let debounce = null;
function scheduleSync(delay = 3000) {
  clearTimeout(debounce);
  debounce = setTimeout(syncNow, delay);
}

// Call once after sign in. Returns a function that stops auto sync.
export function startAutoSync() {
  (async () => {
    const last = await getMeta('last_synced_at');
    setState({ lastSyncedAt: last ? Number(last) : null, pending: await pendingChangesCount() });
    syncNow();
  })();

  let wasOffline = false;
  const unsubNet = NetInfo.addEventListener((s) => {
    const online = s.isConnected && s.isInternetReachable !== false;
    if (online && wasOffline) syncNow();
    if (!online) setState({ status: 'offline' });
    wasOffline = !online;
  });
  const unsubWrite = on('local-write', async () => {
    setState({ pending: await pendingChangesCount() });
    scheduleSync();
  });
  const appSub = AppState.addEventListener('change', (s) => { if (s === 'active') syncNow(); });
  const interval = setInterval(syncNow, INTERVAL_MS);

  return () => {
    unsubNet();
    unsubWrite();
    appSub.remove();
    clearInterval(interval);
    clearTimeout(debounce);
  };
}
