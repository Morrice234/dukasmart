import { getDb, saveRecord } from './database';

// branchId null = all branches added together
function qtySql(branchId) {
  return branchId
    ? `COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.deleted = 0 AND m.branch_id = ?), 0)`
    : `COALESCE((SELECT sum(m.quantity) FROM stock_movements m WHERE m.product_id = p.id AND m.deleted = 0), 0)`;
}

// Products with their current quantity; low stock first, then by name
export async function productsWithStock(search = '', branchId = null) {
  const db = await getDb();
  const params = branchId ? [branchId] : [];
  const rows = await db.getAllAsync(
    `SELECT p.*, ${qtySql(branchId)} AS qty FROM products p
      WHERE p.deleted = 0 AND p.name LIKE ?
      ORDER BY p.name COLLATE NOCASE`,
    [...params, `%${search}%`]
  );
  return rows
    .map((p) => ({ ...p, qty: round(p.qty), low: isLow(p, p.qty) }))
    .sort((a, b) => (b.low - a.low) || a.name.localeCompare(b.name));
}

// Product with this barcode or QR code, or null
export async function productByBarcode(code) {
  const c = String(code || '').trim();
  if (!c) return null;
  const db = await getDb();
  return db.getFirstAsync('SELECT * FROM products WHERE deleted = 0 AND barcode = ?', [c]);
}

export function isLow(p, qty) {
  if (qty <= 0) return true;
  return p.reorder_level != null && p.reorder_level > 0 && qty <= p.reorder_level;
}

export function round(n) {
  return Math.round((Number(n) || 0) * 1000) / 1000;
}

export async function stockSummary(branchId = null) {
  const list = await productsWithStock('', branchId);
  return {
    products: list.length,
    low: list.filter((p) => p.low).length,
    value: list.reduce((n, p) => n + Math.max(0, p.qty) * (p.buy_price || 0), 0),
    retailValue: list.reduce((n, p) => n + Math.max(0, p.qty) * (p.sell_price || 0), 0),
  };
}

export async function getProduct(id, branchId = null) {
  const db = await getDb();
  const params = branchId ? [branchId, id] : [id];
  const p = await db.getFirstAsync(`SELECT p.*, ${qtySql(branchId)} AS qty FROM products p WHERE p.id = ?`, params);
  return p ? { ...p, qty: round(p.qty), low: isLow(p, p.qty) } : null;
}

export async function productByBranch(productId) {
  const db = await getDb();
  return db.getAllAsync(
    `SELECT b.id, b.name, COALESCE((SELECT sum(m.quantity) FROM stock_movements m
              WHERE m.product_id = ? AND m.branch_id = b.id AND m.deleted = 0), 0) AS qty
       FROM branches b WHERE b.deleted = 0 ORDER BY b.created_at`,
    [productId]
  );
}

export async function productMovements(productId, branchId = null, limit = 100) {
  const db = await getDb();
  const [clause, params] = branchId ? [' AND branch_id = ?', [branchId]] : ['', []];
  return db.getAllAsync(
    `SELECT * FROM stock_movements WHERE product_id = ? AND deleted = 0${clause} ORDER BY occurred_at DESC LIMIT ${limit}`,
    [productId, ...params]
  );
}

export async function movementsForSale(saleId) {
  const db = await getDb();
  return db.getAllAsync('SELECT * FROM stock_movements WHERE sale_id = ? AND deleted = 0', [saleId]);
}

// ---------- Writes ----------

export async function addMovement({ productId, branchId, type, quantity, unitCost = null, saleId = null, expenseId = null, note = null, occurredAt = Date.now() }) {
  return saveRecord('stock_movements', {
    product_id: productId,
    branch_id: branchId,
    type,
    quantity: round(quantity),
    unit_cost: unitCost,
    sale_id: saleId,
    expense_id: expenseId,
    note,
    occurred_at: occurredAt,
  });
}

// Stock delivered. Optionally records what was paid as an expense in the same step.
export async function receiveStock({ product, branchId, quantity, unitCost, note, recordExpense, method }) {
  let expenseId = null;
  const now = Date.now();
  if (recordExpense && unitCost > 0) {
    const expense = await saveRecord('expenses', {
      amount: round(quantity * unitCost),
      method: method || 'cash',
      category: 'stock',
      description: `Stock: ${quantity} ${product.unit} ${product.name}`,
      occurred_at: now,
      branch_id: branchId,
    });
    expenseId = expense.id;
  }
  await addMovement({ productId: product.id, branchId, type: 'in', quantity, unitCost: unitCost || null, expenseId, note, occurredAt: now });
  // Keep the buying price up to date with the latest delivery
  if (unitCost > 0 && unitCost !== product.buy_price) {
    await saveRecord('products', { id: product.id, buy_price: unitCost });
  }
}

// Stock count: records the difference so the total matches what is on the shelf
export async function setCountedStock({ product, branchId, counted, currentQty, note }) {
  const diff = round(counted - currentQty);
  if (diff === 0) return null;
  return addMovement({ productId: product.id, branchId, type: 'adjust', quantity: diff, note: note || 'Stock count' });
}

// Sell several products at once: one sale record plus a stock movement per item
// method 'till': the customer paid to the shop's connected till, which records the sale by itself.
// Only the stock is taken off here, so the money is not counted twice.
// saleId and amount come from a paid M-Pesa prompt: the server already made the sale with that id,
// so this fills in the items and takes them off stock without counting the money twice.
export async function sellItems({ items, branchId, method, note, saleId = null, amount = null }) {
  const now = Date.now();
  if (method === 'till') {
    for (const i of items) {
      await addMovement({ productId: i.product.id, branchId, type: 'sale', quantity: -i.qty, unitCost: i.product.buy_price || null, note: 'Paid to till', occurredAt: now });
    }
    return null;
  }
  const total = amount !== null ? amount : round(items.reduce((n, i) => n + i.qty * i.price, 0));
  const description = note || items.map((i) => `${i.qty} ${i.product.name}`).join(', ');
  const sale = await saveRecord('sales', {
    ...(saleId ? { id: saleId } : {}),
    amount: total,
    method,
    description: description.slice(0, 200),
    occurred_at: now,
    branch_id: branchId,
  });
  for (const i of items) {
    await addMovement({ productId: i.product.id, branchId, type: 'sale', quantity: -i.qty, unitCost: i.product.buy_price || null, saleId: sale.id, occurredAt: now });
  }
  return sale;
}

// Deleting a sale that came from stock puts the items back
export async function deleteSaleStock(saleId) {
  const moves = await movementsForSale(saleId);
  for (const m of moves) await saveRecord('stock_movements', { id: m.id, deleted: true });
  return moves.length;
}
