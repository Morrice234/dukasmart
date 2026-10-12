import React, { useEffect, useMemo, useState } from 'react';
import { KeyboardAvoidingView, Modal, Platform, Pressable, ScrollView, Switch, Text, TextInput, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { Button, Chips, Input, s } from '../ui';
import { colors } from '../../theme';
import { money } from '../../utils/format';
import { saveRecord } from '../../db/database';
import { addMovement, receiveStock, round, sellItems, setCountedStock } from '../../db/stock';

export const UNITS = [
  { value: 'pcs', label: 'Pieces' },
  { value: 'kg', label: 'Kg' },
  { value: 'litre', label: 'Litres' },
  { value: 'packet', label: 'Packets' },
  { value: 'box', label: 'Boxes' },
];

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'mpesa', label: 'M-Pesa' },
  { value: 'other', label: 'Other' },
];

export function num(v) {
  const n = Number(String(v || '').replace(/,/g, '').trim());
  return Number.isFinite(n) ? n : NaN;
}

export function qtyText(q, unit) {
  const v = round(q);
  return `${Number.isInteger(v) ? v : v.toFixed(2).replace(/0+$/, '')} ${unit === 'pcs' ? '' : unit}`.trim();
}

// Bottom sheet frame shared by all stock forms
function Sheet({ visible, onClose, title, children }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={visible} animationType="slide" transparent onRequestClose={onClose}>
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1, justifyContent: 'flex-end', backgroundColor: 'rgba(0,0,0,0.35)' }}>
        <View style={{ backgroundColor: colors.bg, borderTopLeftRadius: 20, borderTopRightRadius: 20, maxHeight: '92%' }}>
          <ScrollView contentContainerStyle={{ padding: 20, paddingBottom: 20 + insets.bottom }} keyboardShouldPersistTaps="handled">
            <View style={[s.row, { justifyContent: 'space-between', marginBottom: 16 }]}>
              <Text style={s.h2}>{title}</Text>
              <Pressable onPress={onClose} hitSlop={12}><Ionicons name="close" size={24} color={colors.muted} /></Pressable>
            </View>
            {visible ? children : null}
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function BranchPicker({ branchOptions, value, onChange }) {
  if (!branchOptions || branchOptions.length < 2) return null;
  return (<><Text style={s.label}>Branch</Text><Chips options={branchOptions} value={value} onChange={onChange} /></>);
}

function ErrorText({ text }) {
  return text ? <Text style={{ color: colors.danger, marginBottom: 10 }}>{text}</Text> : null;
}

// ---------- New / edit product ----------

export function ProductSheet({ visible, onClose, product, branchOptions, defaultBranchId, onSaved, onDelete }) {
  const [f, setF] = useState({});
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v }));

  useEffect(() => {
    if (!visible) return;
    setF({
      name: product ? product.name : '',
      unit: product ? product.unit : 'pcs',
      buy: product && product.buy_price != null ? String(product.buy_price) : '',
      sell: product && product.sell_price != null ? String(product.sell_price) : '',
      reorder: product && product.reorder_level != null ? String(product.reorder_level) : '',
      opening: '',
    });
    setBranchId(defaultBranchId);
    setError('');
  }, [visible, product, defaultBranchId]);

  async function save() {
    const name = (f.name || '').trim();
    const buy = f.buy ? num(f.buy) : null;
    const sell = f.sell ? num(f.sell) : null;
    const reorder = f.reorder ? num(f.reorder) : null;
    const opening = f.opening ? num(f.opening) : 0;
    if (!name) { setError('Enter the product name'); return; }
    if ([buy, sell, reorder].some((v) => v !== null && !(v >= 0)) || !(opening >= 0)) { setError('Check the numbers you entered'); return; }
    setSaving(true);
    try {
      const saved = await saveRecord('products', {
        ...(product ? { id: product.id } : {}),
        name, unit: f.unit, buy_price: buy, sell_price: sell, reorder_level: reorder,
      });
      if (!product && opening > 0) {
        await addMovement({ productId: saved.id, branchId, type: 'in', quantity: opening, unitCost: buy, note: 'Opening stock' });
      }
      onSaved && onSaved(saved);
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title={product ? 'Edit product' : 'New product'}>
      <Input label="Product name" value={f.name} onChangeText={set('name')} placeholder="e.g. Sugar 1kg" autoFocus={!product} />
      <Text style={s.label}>Counted in</Text>
      <Chips options={UNITS} value={f.unit} onChange={set('unit')} />
      <View style={s.row}>
        <View style={{ flex: 1, marginRight: 6 }}><Input label="Buying price (KSh)" value={f.buy} onChangeText={set('buy')} keyboardType="numeric" placeholder="0" /></View>
        <View style={{ flex: 1, marginLeft: 6 }}><Input label="Selling price (KSh)" value={f.sell} onChangeText={set('sell')} keyboardType="numeric" placeholder="0" /></View>
      </View>
      {num(f.buy) > 0 && num(f.sell) > 0 ? (
        <Text style={[s.muted, { marginTop: -8, marginBottom: 12 }]}>
          Profit per {f.unit === 'pcs' ? 'piece' : f.unit}: {money(num(f.sell) - num(f.buy))}
        </Text>
      ) : null}
      <Input label="Warn me when stock falls to (optional)" value={f.reorder} onChangeText={set('reorder')} keyboardType="numeric" placeholder="e.g. 5" />
      {!product ? (
        <>
          <Input label="How many do you have now? (optional)" value={f.opening} onChangeText={set('opening')} keyboardType="numeric" placeholder="0" />
          <BranchPicker branchOptions={branchOptions} value={branchId} onChange={setBranchId} />
        </>
      ) : null}
      <ErrorText text={error} />
      <Button title="Save product" onPress={save} loading={saving} />
      {onDelete ? <Button title="Delete product" variant="ghost" style={{ marginTop: 8 }} onPress={async () => { await onDelete(); onClose(); }} /> : null}
    </Sheet>
  );
}

// ---------- Receive / remove / count ----------

const MOVE_COPY = {
  in: { title: 'Receive stock', qtyLabel: 'How many came in?', button: 'Add to stock' },
  out: { title: 'Remove stock', qtyLabel: 'How many to remove?', button: 'Remove from stock' },
  count: { title: 'Count stock', qtyLabel: 'How many are on the shelf now?', button: 'Save count' },
};

const OUT_REASONS = [
  { value: 'Damaged', label: 'Damaged' },
  { value: 'Expired', label: 'Expired' },
  { value: 'Used in shop', label: 'Used in shop' },
  { value: 'Returned to supplier', label: 'Returned' },
  { value: 'Other', label: 'Other' },
];

export function StockMoveSheet({ visible, onClose, mode, product, currentQty, branchOptions, defaultBranchId, branchLabel }) {
  const [qty, setQty] = useState('');
  const [cost, setCost] = useState('');
  const [note, setNote] = useState('');
  const [reason, setReason] = useState('Damaged');
  const [asExpense, setAsExpense] = useState(true);
  const [method, setMethod] = useState('cash');
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const copy = MOVE_COPY[mode] || MOVE_COPY.in;

  useEffect(() => {
    if (!visible) return;
    setQty(mode === 'count' ? String(currentQty) : '');
    setCost(product && product.buy_price != null ? String(product.buy_price) : '');
    setNote(''); setReason('Damaged'); setAsExpense(true); setMethod('cash');
    setBranchId(defaultBranchId); setError('');
  }, [visible, mode, product, currentQty, defaultBranchId]);

  if (!product) return null;

  async function save() {
    const q = num(qty);
    if (!(q >= 0) || (mode !== 'count' && q === 0)) { setError('Enter a quantity'); return; }
    setSaving(true);
    try {
      if (mode === 'in') {
        const c = cost ? num(cost) : 0;
        if (!(c >= 0)) { setError('Check the buying price'); setSaving(false); return; }
        await receiveStock({ product, branchId, quantity: q, unitCost: c, note: note.trim() || null, recordExpense: asExpense, method });
      } else if (mode === 'out') {
        await addMovement({ productId: product.id, branchId, type: 'out', quantity: -q, unitCost: product.buy_price || null, note: [reason, note.trim()].filter(Boolean).join(': ') });
      } else {
        await setCountedStock({ product, branchId, counted: q, currentQty, note: note.trim() || null });
      }
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  const c = num(cost);
  const q = num(qty);
  return (
    <Sheet visible={visible} onClose={onClose} title={`${copy.title}: ${product.name}`}>
      <BranchPicker branchOptions={branchOptions} value={branchId} onChange={setBranchId} />
      {branchLabel ? <Text style={[s.muted, { marginBottom: 10 }]}>At {branchLabel}</Text> : null}
      <Input label={copy.qtyLabel} value={qty} onChangeText={setQty} keyboardType="numeric" autoFocus placeholder="0" style={{ fontSize: 24, height: 60, fontWeight: '700' }} />
      {mode === 'count' ? (
        <Text style={[s.muted, { marginTop: -8, marginBottom: 12 }]}>
          The app shows {qtyText(currentQty, product.unit)}.{q >= 0 && q !== currentQty ? ` Difference: ${q > currentQty ? '+' : ''}${qtyText(q - currentQty, product.unit)}` : ''}
        </Text>
      ) : null}
      {mode === 'in' ? (
        <>
          <Input label="Buying price per item (KSh)" value={cost} onChangeText={setCost} keyboardType="numeric" placeholder="0" />
          <View style={[s.row, { justifyContent: 'space-between', marginBottom: 12 }]}>
            <View style={{ flex: 1 }}>
              <Text style={{ color: colors.text, fontWeight: '600' }}>Record as expense</Text>
              <Text style={[s.muted, { fontSize: 12 }]}>{c > 0 && q > 0 ? `Adds ${money(q * c)} to today's expenses` : 'Adds the cost to today\'s expenses'}</Text>
            </View>
            <Switch value={asExpense} onValueChange={setAsExpense} trackColor={{ true: colors.primary }} />
          </View>
          {asExpense ? (<><Text style={s.label}>Paid by</Text><Chips options={METHODS} value={method} onChange={setMethod} /></>) : null}
        </>
      ) : null}
      {mode === 'out' ? (<><Text style={s.label}>Reason</Text><Chips options={OUT_REASONS} value={reason} onChange={setReason} /></>) : null}
      <Input label="Note (optional)" value={note} onChangeText={setNote} placeholder={mode === 'in' ? 'e.g. From Mwangi wholesalers' : ''} />
      <ErrorText text={error} />
      <Button title={copy.button} onPress={save} loading={saving} />
    </Sheet>
  );
}

// ---------- Sell from stock (cart) ----------

export function SellSheet({ visible, onClose, products, branchOptions, defaultBranchId, initialProductId }) {
  const [search, setSearch] = useState('');
  const [cart, setCart] = useState({}); // productId -> { qty: text, price: text } as typed
  const [method, setMethod] = useState('cash');
  const [branchId, setBranchId] = useState(defaultBranchId);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!visible) return;
    const p = initialProductId && products.find((x) => x.id === initialProductId);
    setCart(p ? { [p.id]: { qty: '1', price: String(p.sell_price || '') } } : {});
    setSearch(''); setMethod('cash'); setBranchId(defaultBranchId); setError('');
  }, [visible, initialProductId, defaultBranchId]); // eslint-disable-line react-hooks/exhaustive-deps

  const byId = useMemo(() => Object.fromEntries(products.map((p) => [p.id, p])), [products]);
  const lines = Object.entries(cart).filter(([id]) => byId[id])
    .map(([id, l]) => ({ product: byId[id], qtyText: l.qty, priceText: l.price, qty: num(l.qty), price: num(l.price) }));
  const total = lines.reduce((n, l) => n + (l.qty > 0 ? l.qty : 0) * (l.price >= 0 ? l.price : 0), 0);
  const matches = search.trim()
    ? products.filter((p) => p.name.toLowerCase().includes(search.trim().toLowerCase())).slice(0, 8)
    : products.slice(0, 8);

  const add = (p) => setCart((c) => ({
    ...c,
    [p.id]: c[p.id]
      ? { ...c[p.id], qty: String(round((num(c[p.id].qty) || 0) + 1)) }
      : { qty: '1', price: String(p.sell_price || '') },
  }));
  const setLine = (id, patch) => setCart((c) => ({ ...c, [id]: { ...c[id], ...patch } }));
  const remove = (id) => setCart((c) => { const n = { ...c }; delete n[id]; return n; });

  async function save() {
    if (!lines.length) { setError('Add at least one item'); return; }
    if (lines.some((l) => !(l.qty > 0) || !(l.price >= 0))) { setError('Check quantities and prices'); return; }
    if (!(total > 0)) { setError('Total must be more than zero. Set a price for each item.'); return; }
    setSaving(true);
    try {
      await sellItems({ items: lines.map(({ product, qty, price }) => ({ product, qty, price })), branchId, method });
      onClose();
    } catch (e) {
      setError(e.message);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Sheet visible={visible} onClose={onClose} title="Sell from stock">
      <BranchPicker branchOptions={branchOptions} value={branchId} onChange={setBranchId} />
      <View style={[s.row, { backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colors.border, paddingHorizontal: 12, marginBottom: 8 }]}>
        <Ionicons name="search" size={18} color={colors.muted} />
        <TextInput value={search} onChangeText={setSearch} placeholder="Find product" placeholderTextColor={colors.muted} style={{ flex: 1, height: 44, marginLeft: 8, color: colors.text }} />
      </View>
      <View style={[s.row, { flexWrap: 'wrap', marginBottom: 12 }]}>
        {matches.map((p) => (
          <Pressable key={p.id} onPress={() => add(p)} style={[s.chip, { flexDirection: 'row', alignItems: 'center' }]}>
            <Ionicons name="add" size={14} color={colors.primary} />
            <Text style={[s.chipText, { marginLeft: 2 }]}>{p.name}</Text>
            <Text style={[s.muted, { fontSize: 11, marginLeft: 4 }]}>({qtyText(p.qty, p.unit)})</Text>
          </Pressable>
        ))}
        {!matches.length ? <Text style={s.muted}>No products match. Add products in the Stock tab first.</Text> : null}
      </View>

      {lines.map((l) => (
        <View key={l.product.id} style={{ backgroundColor: '#fff', borderRadius: 12, borderWidth: 1, borderColor: colors.border, padding: 12, marginBottom: 8 }}>
          <View style={[s.row, { justifyContent: 'space-between' }]}>
            <Text style={{ fontWeight: '700', color: colors.text, flex: 1 }} numberOfLines={1}>{l.product.name}</Text>
            <Pressable onPress={() => remove(l.product.id)} hitSlop={10}><Ionicons name="trash-outline" size={18} color={colors.muted} /></Pressable>
          </View>
          <View style={[s.row, { marginTop: 8 }]}>
            <Pressable onPress={() => setLine(l.product.id, { qty: String(Math.max(0, round((l.qty || 0) - 1))) })} style={stepBtn}><Ionicons name="remove" size={18} color={colors.primary} /></Pressable>
            <TextInput
              value={l.qtyText}
              onChangeText={(v) => setLine(l.product.id, { qty: v })}
              keyboardType="numeric"
              style={{ width: 56, height: 36, textAlign: 'center', fontWeight: '700', color: colors.text }}
            />
            <Pressable onPress={() => setLine(l.product.id, { qty: String(round((l.qty || 0) + 1)) })} style={stepBtn}><Ionicons name="add" size={18} color={colors.primary} /></Pressable>
            <Text style={[s.muted, { marginHorizontal: 8 }]}>x</Text>
            <TextInput
              value={l.priceText}
              onChangeText={(v) => setLine(l.product.id, { price: v })}
              placeholder="Price"
              keyboardType="numeric"
              style={{ flex: 1, height: 36, borderWidth: 1, borderColor: colors.border, borderRadius: 8, paddingHorizontal: 8, color: colors.text }}
            />
            <Text style={{ marginLeft: 8, fontWeight: '700', color: colors.text }}>{money((l.qty || 0) * (l.price || 0))}</Text>
          </View>
          {l.qty > l.product.qty ? (
            <Text style={{ color: colors.warning, fontSize: 12, marginTop: 6 }}>Only {qtyText(l.product.qty, l.product.unit)} in stock. The sale will still be saved.</Text>
          ) : null}
        </View>
      ))}

      {lines.length ? (
        <>
          <View style={[s.row, { justifyContent: 'space-between', marginVertical: 10 }]}>
            <Text style={s.h2}>Total</Text>
            <Text style={{ fontSize: 22, fontWeight: '800', color: colors.primaryDark }}>{money(total)}</Text>
          </View>
          <Text style={s.label}>Paid by</Text>
          <Chips options={METHODS} value={method} onChange={setMethod} />
        </>
      ) : null}
      <ErrorText text={error} />
      <Button title={lines.length ? `Save sale of ${money(total)}` : 'Save sale'} onPress={save} loading={saving} disabled={!lines.length} />
    </Sheet>
  );
}

const stepBtn = { width: 36, height: 36, borderRadius: 18, borderWidth: 1, borderColor: colors.primary, alignItems: 'center', justifyContent: 'center' };
